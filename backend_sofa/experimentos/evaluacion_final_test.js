// ============================ EVALUACIÓN FINAL SOBRE TEST ============================
//
// ÚNICA evaluación sobre el conjunto TEST (378 partidos). Después de ejecutar este
// script NO se cambian parámetros, features, calibración ni se selecciona otra
// versión basándose en TEST.
//
// Modelos evaluados (únicamente):
//   A) V1 sin calibrar          (entrenado en TRAIN+VAL = 1523 partidos)
//   B) V1 + Platt               (mismo modelo base + Platt ajustado SIN TEST)
//
// Anti-leakage:
//   - El modelo base final se entrena SOLO con TRAIN+VAL (1523), jamás con TEST.
//   - El Platt se ajusta SOLO con predicciones fuera de muestra de un corte
//     interior temporal (75% de TV, día entero): innerFit < innerCal < TEST.
//   - λ = 0.1 fijo a priori (idéntico a fase_calibracion; no se tunea aquí).
//   - Ningún parámetro aprendido con TEST. Sin reglas manuales ni umbrales.
//   - prediccion_poisson.json NO se modifica. Nada se promueve a producción.
//
// Uso: node experimentos/evaluacion_final_test.js
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("./modelo_mu_exp");
const { ajustarPlatt, aplicarPlatt, plattParaInforme } = require("./platt");
const { calcularMetricas, dividirTemporal } = require("../services/prediccion/backtest");
const { probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");

const CLASES = ["home", "draw", "away"];
const LAMBDA_PLATT = 0.1;
const FRAC_INNER = 0.75;
const r4 = (x) => Math.round(x * 10000) / 10000;
const pct = (x, d = 2) => (x * 100).toFixed(d) + "%";
const argmax = (p) => CLASES.reduce((a, b) => (p[a] >= p[b] ? a : b));
const realDe = (p) => (p.goalsH > p.goalsA ? "home" : p.goalsH === p.goalsA ? "draw" : "away");
const dia = (m) => new Date(m.fecha).toISOString().slice(0, 10);

// Referencias históricas de VALIDACIÓN (pooled W1-W4, fase_calibracion) — SOLO
// para comparar, nunca para modificar nada.
const VAL_REF = {
  A: { accuracy: 0.4659, logLoss: 1.1100, brier: 0.6582, ece: 0.2288, cnt: { home: 484, draw: 63, away: 215 }, prom: { home: 0.461, draw: 0.254, away: 0.285 } },
  B: { accuracy: 0.4633, logLoss: 1.0630, brier: 0.6389, ece: 0.0988, cnt: { home: 529, draw: 68, away: 165 }, prom: { home: 0.445, draw: 0.273, away: 0.282 } },
  ext: {
    A: { recallDraw: 0.085, f1Draw: 0.1293, llDraw: 1.4266, recallAway: 0.3839, precisionAway: 0.3767, llAway: 1.3079, llHome: null },
    B: { recallDraw: 0.095, f1Draw: 0.1418, llDraw: 1.3471, recallAway: 0.3033, precisionAway: 0.3879, llAway: 1.2283, llHome: null },
  },
};

function fracV1(modelo, p) {
  const ligas = modelo.ligas || {};
  const base = ligas[p.liga] || { muHome: modelo.muHomeGlobal, muAway: modelo.muAwayGlobal };
  const lh = Math.exp(Math.log(base.muHome) + (modelo.att[p.home] ?? 0) - (modelo.def[p.away] ?? 0));
  const la = Math.exp(Math.log(base.muAway) + (modelo.att[p.away] ?? 0) - (modelo.def[p.home] ?? 0));
  return probsDesdeLambdas(lh, la);
}

function evaluarV1(modelo, partidos, platt = null) {
  const preds = partidos.map((p) => {
    const frac = fracV1(modelo, p);
    const f2 = platt ? aplicarPlatt(platt, frac) : frac;
    const probs = aPorcentajes(f2.home, f2.draw, f2.away, 1);
    return {
      fecha: p.fecha, home: p.home, away: p.away, liga: p.liga,
      probs, real: realDe(p), marcador: `${p.goalsH}-${p.goalsA}`,
      argmax: argmax(probs),
    };
  });
  return { preds, metricas: calcularMetricas(preds) };
}

function extendidas(preds) {
  const n = preds.length;
  const cm = { home: { home: 0, draw: 0, away: 0 }, draw: { home: 0, draw: 0, away: 0 }, away: { home: 0, draw: 0, away: 0 } };
  const suma = { home: 0, draw: 0, away: 0 };
  const cnt = { home: 0, draw: 0, away: 0 };
  let conf = 0;
  for (const p of preds) {
    const am = argmax(p.probs);
    cm[am][p.real]++;
    cnt[am]++;
    suma.home += p.probs.home; suma.draw += p.probs.draw; suma.away += p.probs.away;
    conf += p.probs[am];
  }
  const por = {};
  for (const k of CLASES) {
    const tp = cm[k][k];
    const realN = CLASES.reduce((a, c) => a + cm[c][k], 0);
    const predN = CLASES.reduce((a, c) => a + cm[k][c], 0);
    const recall = realN ? tp / realN : null;
    const precision = predN ? tp / predN : null;
    por[k] = { recall, precision, f1: recall !== null && precision ? (2 * precision * recall) / (precision + recall) : null, realN, predN };
  }
  return { cm, cnt, por, conf: conf / n / 100, prom: { home: suma.home / n / 100, draw: suma.draw / n / 100, away: suma.away / n / 100 } };
}

function llSubconjunto(preds, clase) {
  const sub = preds.filter((x) => x.real === clase);
  if (!sub.length) return null;
  return Math.round((sub.reduce((a, x) => a - Math.log(Math.max(1e-15, x.probs[clase] / 100)), 0) / sub.length) * 10000) / 10000;
}

// Brier por clase: media de (p_k − 1{real=k})² sobre los 378 (suma = Brier multiclase)
function brierPorClase(preds) {
  const acc = { home: 0, draw: 0, away: 0 };
  for (const p of preds) for (const k of CLASES) acc[k] += (p.probs[k] / 100 - (p.real === k ? 1 : 0)) ** 2;
  return { home: r4(acc.home / preds.length), draw: r4(acc.draw / preds.length), away: r4(acc.away / preds.length) };
}

(async () => {
  console.log("==================== EVALUACIÓN FINAL — TEST (única) ====================");
  const { rows } = await pool.query(`
    SELECT id, fecha_partido, liga, equipo_local, equipo_visitante, goles_local, goles_visitante
    FROM partidos WHERE estado='Ended' AND fecha_partido IS NOT NULL
      AND goles_local IS NOT NULL AND goles_visitante IS NOT NULL
    ORDER BY fecha_partido ASC, id ASC;`);
  const partidos = rows.map((x) => ({
    id: x.id, fecha: x.fecha_partido, liga: x.liga, home: x.equipo_local, away: x.equipo_visitante,
    goalsH: x.goles_local, goalsA: x.goles_visitante,
  }));
  const bloques = dividirTemporal(partidos, { trainPct: 0.6, valPct: 0.2 });
  const TV = [...bloques.train, ...bloques.val];
  const TEST = bloques.test;
  const nTrain = bloques.train.length;
  console.log(`TRAIN ${nTrain} | VAL ${bloques.val.length} | TV(entrenamiento) ${TV.length} | TEST ${TEST.length}`);
  console.log(`fechas: TV ${dia(TV[0])} → ${dia(TV[TV.length - 1])} | TEST ${dia(TEST[0])} → ${dia(TEST[TEST.length - 1])}`);

  // ---- SPLIT INTERNO de TV para el Platt (75/25 día-estricto; TEST jamás) ----
  const cortar = (arr, i) => {
    i = Math.max(1, Math.min(arr.length - 1, i));
    while (i < arr.length && dia(arr[i - 1]) === dia(arr[i])) i += 1;
    return i;
  };
  const ci = cortar(TV, Math.floor(TV.length * FRAC_INNER));
  const innerFit = TV.slice(0, ci);
  const innerCal = TV.slice(ci);
  console.log(`Platt interior (solo TRAIN+VAL): innerFit ${innerFit.length} (${dia(innerFit[0])}→${dia(innerFit[innerFit.length - 1])}) | innerCal ${innerCal.length} (${dia(innerCal[0])}→${dia(innerCal[innerCal.length - 1])})`);

  const mInner = entrenarExp(innerFit, "SPEC30");
  const muestras = innerCal.map((p) => ({ frac: fracV1(mInner, p), real: realDe(p) }));
  const platt = ajustarPlatt(muestras, { lambda: LAMBDA_PLATT });

  // ---- MODELO FINAL: entrenado SOLO en TV (TRAIN+VAL) ----
  const mFinal = entrenarExp(TV, "SPEC30");

  const evA = evaluarV1(mFinal, TEST, null);
  const evB = evaluarV1(mFinal, TEST, platt);
  const extA = extendidas(evA.preds);
  const extB = extendidas(evB.preds);

  // ---- SANIDADES FINALES ----
  const san = {};
  san.nTestEvaluado378 = TEST.length === 378 && evA.preds.length === 378 && evB.preds.length === 378;
  san.testFueraDeEntrenamiento = TV.length === nTrain + bloques.val.length && innerFit.length + innerCal.length === TV.length && dia(TV[TV.length - 1]) < dia(TEST[0]);
  san.testFueraDeCalibracion = dia(innerCal[innerCal.length - 1]) < dia(TEST[0]) && muestras.length === innerCal.length;
  san.parametrosAprendidosSinTest = platt.n === innerCal.length && dia(innerCal[innerCal.length - 1]) < dia(TEST[0]) && Number.isFinite(platt.nllDespues);
  let sumasOk = true, hayNaN = false, hayNeg = false;
  for (const ev of [evA, evB]) for (const p of ev.preds) {
    const s = p.probs.home + p.probs.draw + p.probs.away;
    if (s !== 100) sumasOk = false;
    for (const k of CLASES) {
      if (!Number.isFinite(p.probs[k])) hayNaN = true;
      if (p.probs[k] < 0) hayNeg = true;
    }
  }
  san.probsSuman100Exacto = sumasOk;
  san.ceroNaN = !hayNaN && ["accuracy", "logLoss", "brier", "ece"].every((k) => Number.isFinite(evA.metricas[k]) && Number.isFinite(evB.metricas[k]));
  san.ceroNegativos = !hayNeg;
  san.fechasCorrectas = dia(innerCal[innerCal.length - 1]) < dia(TEST[0]) && dia(TEST[0]) <= dia(TEST[TEST.length - 1]);
  san.sinLeakageTemporal = dia(TV[TV.length - 1]) < dia(TEST[0]);
  san.sinModificacionPosterior = true; // este script solo escribe el informe; no toca modelos/ ni parámetros

  // suma de Brier por clase ≈ Brier multiclase (coherencia)
  const bpA = brierPorClase(evA.preds);
  const bpB = brierPorClase(evB.preds);
  san.brierPorClaseCoherente = Math.abs((bpA.home + bpA.draw + bpA.away) - evA.metricas.brier) < 0.001 && Math.abs((bpB.home + bpB.draw + bpB.away) - evB.metricas.brier) < 0.001;

  const sanOk = Object.values(san).every((x) => x === true);
  console.log("\n--- SANIDADES FINALES ---");
  for (const [k, v] of Object.entries(san)) console.log(`  ${v ? "✓" : "✗"} ${k}: ${v}`);
  if (!sanOk) throw new Error("Sanidades finales fallidas — abortar");

  // ---- TABLA PRINCIPAL ----
  const fila = (id, desc, m, e) =>
    `${id} | ${desc.padEnd(14)} | ${pct(m.accuracy)} | ${m.logLoss.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.ece.toFixed(4)} | ${String(e.cnt.home).padStart(4)} | ${String(e.cnt.draw).padStart(4)} | ${String(e.cnt.away).padStart(4)}`;
  console.log("\n--- TEST · TABLA PRINCIPAL (378 partidos) ---");
  console.log("Modelo | Calibración    | Accuracy | LogLoss | Brier  | ECE    | Pred H | Pred E | Pred A");
  console.log(fila("A", "V1 sin calibrar", evA.metricas, extA));
  console.log(fila("B", "V1 + Platt", evB.metricas, extB));

  console.log("\n--- TEST · Δ B respecto a V1 (negativo = mejora) ---");
  console.log("Modelo | ΔAccuracy | ΔLogLoss | ΔBrier | ΔECE");
  console.log(`B      | ${((evB.metricas.accuracy - evA.metricas.accuracy) >= 0 ? "+" : "") + (evB.metricas.accuracy - evA.metricas.accuracy).toFixed(4)}    | ${((evB.metricas.logLoss - evA.metricas.logLoss) >= 0 ? "+" : "") + (evB.metricas.logLoss - evA.metricas.logLoss).toFixed(4)}    | ${((evB.metricas.brier - evA.metricas.brier) >= 0 ? "+" : "") + (evB.metricas.brier - evA.metricas.brier).toFixed(4)}   | ${((evB.metricas.ece - evA.metricas.ece) >= 0 ? "+" : "") + (evB.metricas.ece - evA.metricas.ece).toFixed(4)}`);

  console.log("\n--- PROBABILIDADES PROMEDIO (P(H)/P(E)/P(A)) y confianza ---");
  console.log("Modelo | P(H)    | P(E)    | P(A)    | conf media");
  for (const [id, e] of [["A", extA], ["B", extB]]) {
    console.log(`${id}      | ${pct(e.prom.home, 1).padStart(7)} | ${pct(e.prom.draw, 1).padStart(7)} | ${pct(e.prom.away, 1).padStart(7)} | ${pct(e.conf, 1)}`);
  }

  console.log("\n--- MATRICES DE CONFUSIÓN Y TASAS (TEST) ---");
  for (const [id, desc, e] of [["A", "V1 sin calibrar", extA], ["B", "V1 + Platt", extB]]) {
    console.log(`\n  ${id} (${desc})`);
    console.log("            REAL\n          H     E     A");
    console.log(`  PRED HOME   ${String(e.cm.home.home).padStart(3)}   ${String(e.cm.home.draw).padStart(3)}   ${String(e.cm.home.away).padStart(3)}`);
    console.log(`  PRED DRAW    ${String(e.cm.draw.home).padStart(3)}   ${String(e.cm.draw.draw).padStart(3)}   ${String(e.cm.draw.away).padStart(3)}`);
    console.log(`  PRED AWAY    ${String(e.cm.away.home).padStart(3)}   ${String(e.cm.away.draw).padStart(3)}   ${String(e.cm.away.away).padStart(3)}`);
    for (const k of CLASES) {
      const p = e.por[k];
      console.log(`    ${k.padEnd(4)} recall=${pct(p.recall)} precision=${pct(p.precision)} F1=${pct(p.f1)} (real ${p.realN} / pred ${p.predN})`);
    }
  }

  const llHA = llSubconjunto(evA.preds, "home"), llEA = llSubconjunto(evA.preds, "draw"), llAA = llSubconjunto(evA.preds, "away");
  const llHB = llSubconjunto(evB.preds, "home"), llEB = llSubconjunto(evB.preds, "draw"), llAB = llSubconjunto(evB.preds, "away");
  console.log("\n--- LogLoss POR RESULTADO REAL (TEST) ---");
  console.log("Modelo | LL(solo H) | LL(solo E) | LL(solo A)");
  console.log(`A      | ${llHA.toFixed(4).padStart(10)} | ${llEA.toFixed(4).padStart(10)} | ${llAA.toFixed(4).padStart(10)}`);
  console.log(`B      | ${llHB.toFixed(4).padStart(10)} | ${llEB.toFixed(4).padStart(10)} | ${llAB.toFixed(4).padStart(10)}`);

  console.log("\n--- BRIER POR CLASE (TEST) — suma ≈ Brier multiclase ---");
  console.log("Modelo | Brier H  | Brier E  | Brier A  | suma");
  for (const [id, bp, m] of [["A", bpA, evA.metricas], ["B", bpB, evB.metricas]]) {
    console.log(`${id}      | ${bp.home.toFixed(4)} | ${bp.draw.toFixed(4)} | ${bp.away.toFixed(4)} | ${(bp.home + bp.draw + bp.away).toFixed(4)}`);
  }

  // ---- COMPARACIÓN CON VALIDACIÓN HISTÓRICA (sin modificar nada) ----
  console.log("\n--- TEST vs VALIDACIÓN POOLED (histórica, referencia) ---");
  console.log("Modelo | Métrica    | VAL      | TEST     | Δ TEST−VAL");
  const comparar = [];
  for (const [id, ev] of [["A", evA], ["B", evB]]) {
    for (const k of ["accuracy", "logLoss", "brier", "ece"]) {
      const v = VAL_REF[id][k], t = ev.metricas[k];
      comparar.push({ modelo: id, metrica: k, val: v, test: t, delta: r4(t - v) });
      console.log(`${id}      | ${k.padEnd(10)} | ${v.toFixed(4)} | ${t.toFixed(4)} | ${(t - v >= 0 ? "+" : "") + (t - v).toFixed(4)}`);
    }
  }

  const dLL = r4(evB.metricas.logLoss - evA.metricas.logLoss);
  const dBrier = r4(evB.metricas.brier - evA.metricas.brier);
  const dECE = r4(evB.metricas.ece - evA.metricas.ece);
  const dAcc = r4(evB.metricas.accuracy - evA.metricas.accuracy);
  const valDLL = VAL_REF.B.logLoss - VAL_REF.A.logLoss;

  const q1 = dLL < 0, q2 = dBrier < 0, q3 = dECE < 0;
  const dDistH = r4(extB.prom.home - extA.prom.home);
  const dDistE = r4(extB.prom.draw - extA.prom.draw);
  const dDistA = r4(extB.prom.away - extA.prom.away);

  console.log("\n=========== RESUMEN EJECUTIVO ===========");
  console.log(`1. V1 TEST:           Acc ${pct(evA.metricas.accuracy)} | LogLoss ${evA.metricas.logLoss.toFixed(4)} | Brier ${evA.metricas.brier.toFixed(4)} | ECE ${evA.metricas.ece.toFixed(4)}`);
  console.log(`2. V1 + Platt TEST:   Acc ${pct(evB.metricas.accuracy)} | LogLoss ${evB.metricas.logLoss.toFixed(4)} | Brier ${evB.metricas.brier.toFixed(4)} | ECE ${evB.metricas.ece.toFixed(4)}`);
  console.log(`3. Δ B vs V1 (TEST):  ΔAcc ${dAcc >= 0 ? "+" : ""}${dAcc} | ΔLL ${dLL >= 0 ? "+" : ""}${dLL} | ΔBrier ${dBrier >= 0 ? "+" : ""}${dBrier} | ΔECE ${dECE >= 0 ? "+" : ""}${dECE}`);
  console.log(`4. VAL vs TEST:       V1 LL 1.1100→${evA.metricas.logLoss.toFixed(4)} (Δ${(evA.metricas.logLoss - 1.11 >= 0 ? "+" : "") + (evA.metricas.logLoss - 1.11).toFixed(4)}) | B LL 1.0630→${evB.metricas.logLoss.toFixed(4)} (Δ${(evB.metricas.logLoss - 1.063 >= 0 ? "+" : "") + (evB.metricas.logLoss - 1.063).toFixed(4)}) | beneficio Platt: VAL ${valDLL.toFixed(4)} → TEST ${dLL.toFixed(4)}`);
  console.log(`5. Empates:           A recall ${pct(extA.por.draw.recall)} F1 ${pct(extA.por.draw.f1)} LL ${llEA.toFixed(4)} | B recall ${pct(extB.por.draw.recall)} F1 ${pct(extB.por.draw.f1)} LL ${llEB.toFixed(4)}`);
  console.log(`6. Visitantes:        A recall ${pct(extA.por.away.recall)} precision ${pct(extA.por.away.precision)} LL ${llAA.toFixed(4)} | B recall ${pct(extB.por.away.recall)} precision ${pct(extB.por.away.precision)} LL ${llAB.toFixed(4)}`);
  console.log(`7. "TEST fue utilizado únicamente para evaluación final y no para entrenamiento, calibración ni selección."`);

  // ---- INFORME JSON ----
  const informe = {
    generado: new Date().toISOString(),
    evaluacion: "ÚNICA evaluación final sobre TEST. Ningún cambio posterior a este informe.",
    nota: "Modelos finales: V1 entrenado en TRAIN+VAL (1523); Platt λ=0.1 fijo a priori, ajustado solo con innerCal (75/25 día-estricto de TRAIN+VAL, fuera de muestra de innerFit). TEST solo evaluación. Sin reglas manuales ni umbrales. prediccion_poisson.json no modificado.",
    muestra: {
      train: nTrain, val: bloques.val.length, tv: TV.length, test: TEST.length,
      fechas: { tv: [dia(TV[0]), dia(TV[TV.length - 1])], test: [dia(TEST[0]), dia(TEST[TEST.length - 1])], innerFit: [dia(innerFit[0]), dia(innerFit[innerFit.length - 1])], innerCal: [dia(innerCal[0]), dia(innerCal[innerCal.length - 1])] },
    },
    platt: { ...plattParaInforme(platt), nInnerFit: innerFit.length, nInnerCal: innerCal.length, fechasInnerCal: [dia(innerCal[0]), dia(innerCal[innerCal.length - 1])], precedeATest: dia(innerCal[innerCal.length - 1]) < dia(TEST[0]) },
    sanidades: san,
    modelos: {
      A: {
        desc: "V1 sin calibrar",
        metricas: evA.metricas,
        prob: extA.prom, pred: extA.cnt, confianzaMedia: r4(extA.conf),
        confusion: extA.cm, porClase: extA.por,
        llPorResultado: { home: llHA, draw: llEA, away: llAA },
        brierPorClase: bpA,
        validacionRef: VAL_REF.A,
        valVsTest: Object.fromEntries(["accuracy", "logLoss", "brier", "ece"].map((k) => [k, r4(evA.metricas[k] - VAL_REF.A[k])])),
      },
      B: {
        desc: "V1 + Platt",
        metricas: evB.metricas,
        prob: extB.prom, pred: extB.cnt, confianzaMedia: r4(extB.conf),
        confusion: extB.cm, porClase: extB.por,
        llPorResultado: { home: llHB, draw: llEB, away: llAB },
        brierPorClase: bpB,
        validacionRef: VAL_REF.B,
        valVsTest: Object.fromEntries(["accuracy", "logLoss", "brier", "ece"].map((k) => [k, r4(evB.metricas[k] - VAL_REF.B[k])])),
      },
    },
    deltaTestBvsA: { accuracy: dAcc, logLoss: dLL, brier: dBrier, ece: dECE },
    deltaDistribucionBvsA: { pH: dDistH, pE: dDistE, pA: dDistA },
    resumen: {
      plattMejoraLLenTest: q1,
      plattMejoraBrierEnTest: q2,
      plattMejoraECEEnTest: q3,
      accuracySube: dAcc > 0,
      beneficioLL: { val: r4(valDLL), test: dLL },
      testIntactoPreviamente: true,
      testSoloEvaluacion: "TEST fue utilizado únicamente para evaluación final y no para entrenamiento, calibración ni selección.",
      sinCambiosPosteriores: true,
      candidatoSinCambios: "B (V1 + Platt) — seleccionado antes de ver TEST; no se modifica tras observarlo.",
    },
  };
  const ruta = path.join(__dirname, "informes", "evaluacion_final_test.json");
  fs.writeFileSync(ruta, JSON.stringify(informe, null, 2));
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("Fin de la evaluación final. Sin cambios posteriores.");

  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
