// ---------------------------------------------------------------------------
// FASE 4 — EVALUACIÓN ÚNICA EN TEST (378 partidos, 2026-06-19 … 2026-09-27).
//
// Reglas pre-registradas (escritas ANTES de ejecutar):
//  1. TEST se carga UNA sola vez (SQL con ventana del split oficial) y el
//     conteo debe ser exactamente split.test.n=378 o el script se DETIENE
//     (drift de datos).
//  2. Modelos evaluados: V1 (refit sobre TV=1523) y A (V1+Elo K=32, refit
//     sobre TV). Davidson/Dixon-Coles NO se evalúan: perdieron en 3.6/3.7.
//  3. La evaluación de A en TEST es PRIMERA Y ÚNICA: sin shopping de
//     variantes. V1 en TEST ya estaba registrado en backtest.test desde
//     Fase 1 (LL 0.9719); aquí se replica como SANIDAD del pipeline.
//  4. Criterio de decisión (conservador):
//       promocion      = ΔLL ≤ −0.005 AND ΔBrier ≤ 0 AND ΔAcc ≥ −0.005
//                        AND ΔECE ≤ +0.005   (Δ = A − V1 en TEST)
//       mejora_marginal= −0.005 < ΔLL < 0   → NO promoción automática
//       no_mejora      = ΔLL ≥ 0            → mantener V1
//  5. Sin leakage: modelos entrenados sólo con TV (≤ 2026-06-18); Elo del
//     TEST calculado en una pasada cronológica [...TV, ...TEST] usando
//    _ratings previos_ a cada partido.
//
// V1_BETA / modelos/prediccion_poisson.json / endpoints NO se modifican.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { entrenarConFeatures } = require("../experimentos/modelo_elo_exp");
const { calcularElo } = require("../experimentos/elo");
const { evaluar } = require("../services/prediccion/backtest");
const { poisPmf, K } = require("../experimentos_fase3/davidson");
const {
  r4, realDe, dia, cargarTV, evaluarExp,
  extendidas, llSubconjunto, modeloJson,
} = require("../experimentos_fase3/comun");

const guardarInforme4 = (nombre, obj) => {
  const dir = path.join(__dirname, "informes");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, nombre);
  fs.writeFileSync(ruta, JSON.stringify(obj, null, 2));
  return ruta;
};

// Carga SOLO la ventana oficial de TEST (una sola vez).
async function cargarTest() {
  const m = modeloJson();
  const valHasta = m.backtest.split.val.hasta.slice(0, 10);   // 2026-06-18
  const testHasta = m.backtest.split.test.hasta.slice(0, 10); // 2026-09-27
  const nEsperado = m.backtest.split.test.n;                  // 378
  const { rows } = await pool.query(`
    SELECT id, fecha_partido, liga, equipo_local, equipo_visitante, goles_local, goles_visitante
    FROM partidos
    WHERE estado='Ended' AND fecha_partido IS NOT NULL
      AND goles_local IS NOT NULL AND goles_visitante IS NOT NULL
      AND fecha_partido > '${valHasta}' AND fecha_partido <= '${testHasta}'
    ORDER BY fecha_partido ASC, id ASC;`);
  const test = rows.map((x) => ({
    id: x.id,
    fecha: x.fecha_partido, liga: x.liga, home: x.equipo_local, away: x.equipo_visitante,
    goalsH: x.goles_local, goalsA: x.goles_visitante,
  }));
  if (test.length !== nEsperado) {
    throw new Error(`DRIFT DE DATOS: TEST ${test.length}/${nEsperado} — detener y revisar.`);
  }
  return { test, valHasta, testHasta };
}

const igualesParams = (a, b) => {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const va = a[k], vb = b[k];
    if (va && vb && typeof va === "object" && typeof vb === "object") return igualesParams(va, vb);
    return va === vb;
  });
};

// Celdas de marcador esperadas bajo Poisson (0-0, 1-1, 2-2) — misma
// normalización Z que probsDesdeLambdas.
function esperadasCeldas(preds) {
  const e = { "0-0": 0, "1-1": 0, "2-2": 0 };
  for (const p of preds) {
    const pH = [], pA = [];
    for (let k = 0; k <= K; k++) { pH.push(poisPmf(k, p.lambdaHome)); pA.push(poisPmf(k, p.lambdaAway)); }
    let Z = 0;
    for (let i = 0; i <= K; i++) for (let j = 0; j <= K; j++) Z += pH[i] * pA[j];
    e["0-0"] += (pH[0] * pA[0]) / Z;
    e["1-1"] += (pH[1] * pA[1]) / Z;
    e["2-2"] += (pH[2] * pA[2]) / Z;
  }
  for (const k of Object.keys(e)) e[k] = Math.round(e[k] * 100) / 100;
  return e;
}
const observadasCeldas = (preds) => {
  const o = { "0-0": 0, "1-1": 0, "2-2": 0 };
  for (const p of preds) if (p.marcador in o) o[p.marcador] += 1;
  return o;
};

// LogLoss por partido (mismo camino que calcularMetricas: probs de 1 decimal).
const llDe = (p) => -Math.log(Math.max(1e-15, p.probs[p.real] / 100));

(async () => {
  console.log("=========== FASE 4 — EVALUACIÓN ÚNICA EN TEST ===========");
  const json = modeloJson();

  // ---------- 1) DATOS ----------
  const { TV, valHasta, trainHasta } = await cargarTV(pool);
  const { test, testHasta } = await cargarTest();
  console.log(`TV ${TV.length} (train ${trainHasta} → val ${valHasta}) | TEST ${test.length} (${dia(test[0])} … ${dia(test[test.length - 1])})`);

  // solape/orden
  const idsTV = new Set(TV.map((p) => p.id));
  const solape = test.some((p) => idsTV.has(p.id));
  const rangoOk = test.every((p) => { const d = dia(p); return d > valHasta && d <= testHasta; });
  const ordenOk = test.every((p, i) => i === 0 || new Date(test[i - 1].fecha) <= new Date(p.fecha));
  if (solape || !rangoOk || !ordenOk) throw new Error(`TEST inválido: solape=${solape} rango=${rangoOk} orden=${ordenOk}`);

  // ---------- 2) SANIDADES (antes de interpretar A en TEST) ----------
  const sanidades = {};
  sanidades.tvDrift = TV.length === json.backtest.split.train.n + json.backtest.split.val.n;
  sanidades.testDrift = test.length === json.backtest.split.test.n;

  // 2a) V1 refit TV == parámetros de producción (JSON)
  const v1 = entrenarExp(TV, "SPEC30");
  sanidades.v1ParamsIguales = igualesParams(
    { muHomeGlobal: v1.muHomeGlobal, muAwayGlobal: v1.muAwayGlobal, ligas: v1.ligas, att: v1.att, def: v1.def },
    { muHomeGlobal: json.parametros.muHomeGlobal, muAwayGlobal: json.parametros.muAwayGlobal, ligas: json.parametros.ligas, att: json.parametros.att, def: json.parametros.def },
  );
  // 2b) V1 en TEST reproduce backtest.test (r4) — camino producción + camino exp
  const evV1prod = evaluar(json.parametros, test);
  const evV1 = evaluarExp(v1, test);
  const bt = json.backtest.test;
  sanidades.v1TestReplica =
    evV1prod.metricas.accuracy === bt.accuracy && evV1prod.metricas.logLoss === bt.logLoss &&
    evV1prod.metricas.brier === bt.brier && evV1prod.metricas.ece === bt.ece;
  sanidades.v1RefitIgualProd = evV1.metricas.logLoss === evV1prod.metricas.logLoss && evV1.metricas.accuracy === evV1prod.metricas.accuracy;

  // 2c) A pipeline: refit sobre TRAIN + eval VAL == A OFICIAL de fase 3.4
  const f4prev = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "experimentos_fase3", "informes", "fase3_4_af.json"), "utf8"));
  const nTrain = json.backtest.split.train.n;
  const { antes: antesTV } = calcularElo(TV, { k: 32 });
  const augTV = TV.map((p, i) => ({ ...p, eloHome: antesTV[i].home, eloAway: antesTV[i].away }));
  const aOficial = entrenarConFeatures(augTV.slice(0, nTrain), "SPEC30", { conElo: true });
  const evAof = evaluarExp(aOficial, augTV.slice(nTrain));
  const aOficialRef = f4prev.modelos.A.porVentana.OFICIAL.logLoss;
  sanidades.aOficialReproducido = Math.abs(evAof.metricas.logLoss - aOficialRef) < 1e-9;

  // 2d) A refit TV: hiperparámetros y finitud
  const a = entrenarConFeatures(augTV, "SPEC30", { conElo: true });
  sanidades.aBetaFinito = Number.isFinite(a.beta) && Math.abs(a.beta) < 1;
  sanidades.aEntreno1523 = a.entrenamiento.partidos === TV.length;

  console.log("\nSANIDADES:");
  for (const [k, v] of Object.entries(sanidades)) console.log(`  ${k}: ${v ? "SÍ ✓" : "NO ✗"}`);
  if (Object.values(sanidades).some((x) => !x)) throw new Error("Sanidades FALLIDAS — no evaluar TEST.");
  console.log(`  V1/TEST == backtest.test (registrado en Fase 1): LL ${bt.logLoss} · acc ${bt.accuracy} ✓`);
  console.log(`  A/OFICIAL reproducido: LL ${evAof.metricas.logLoss} (ref fase3.4 ${aOficialRef}) ✓`);

  // ---------- 3) EVALUACIÓN ÚNICA EN TEST ----------
  const { antes: antesAll } = calcularElo([...TV, ...test], { k: 32 }); // cronológico, sin leakage
  const augTest = test.map((p, i) => ({ ...p, eloHome: antesAll[TV.length + i].home, eloAway: antesAll[TV.length + i].away }));
  const evA = evaluarExp(a, augTest);

  const modelos = {
    V1: { desc: "V1 (refit TV=1523)", beta: null, metricas: evV1.metricas, ext: extendidas(evV1.predicciones) },
    A: { desc: "A = V1 + Elo K=32 (refit TV=1523)", beta: a.beta, metricas: evA.metricas, ext: extendidas(evA.predicciones) },
  };

  // ---------- 4) MÉTRICAS, SEGMENTOS, COMPOSICIÓN, PAREADO ----------
  const resumen = (ev) => {
    const n = ev.predicciones.length;
    const realCnt = { home: 0, draw: 0, away: 0 };
    for (const p of ev.predicciones) realCnt[p.real] += 1;
    return {
      n,
      metricas: ev.metricas,
      ext: extendidas(ev.predicciones),
      real: realCnt,
      ll: {
        empates: llSubconjunto(ev.predicciones, "draw"),
        local: llSubconjunto(ev.predicciones, "home"),
        visita: llSubconjunto(ev.predicciones, "away"),
      },
      nEmpates: realCnt.draw,
      sumaPE: Math.round(ev.predicciones.reduce((s, p) => s + p.probs.draw / 100, 0) * 100) / 100,
      composicion: { observado: observadasCeldas(ev.predicciones), esperado: esperadasCeldas(ev.predicciones) },
    };
  };
  const sV1 = resumen(evV1), sA = resumen(evA);

  // pareado (A − V1) por partido
  const d = evA.predicciones.map((p, i) => llDe(p) - llDe(evV1.predicciones[i]));
  const n = d.length;
  const media = d.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const pareado = {
    mediaDeltaLL: r4(media), sd: r4(sd), se: r4(se),
    ic95: [r4(media - 1.96 * se), r4(media + 1.96 * se)],
    ganaA: d.filter((x) => x < -1e-12).length,
    ganaV1: d.filter((x) => x > 1e-12).length,
    empate: d.filter((x) => Math.abs(x) <= 1e-12).length,
    significativo: Math.abs(media) > 1.96 * se,
  };

  // ---------- 5) DECISIÓN (criterio pre-registrado) ----------
  const dLL = r4(modelos.A.metricas.logLoss - modelos.V1.metricas.logLoss);
  const dBrier = r4(modelos.A.metricas.brier - modelos.V1.metricas.brier);
  const dAcc = r4(modelos.A.metricas.accuracy - modelos.V1.metricas.accuracy);
  const dECE = r4(modelos.A.metricas.ece - modelos.V1.metricas.ece);
  let decision;
  if (dLL <= -0.005 && dBrier <= 0 && dAcc >= -0.005 && dECE <= 0.005) decision = "PROMOVER_A";
  else if (dLL < 0) decision = "MEJORA_MARGINAL_NO_PROMOVER";
  else decision = "NO_MEJORA_MANTENER_V1";

  console.log("\n=========== RESULTADO TEST (n=378) ===========");
  console.log("Modelo | LogLoss | Brier  | ECE    | Accuracy | ΣP(E) | LL empates");
  for (const [id, s] of [["V1", sV1], ["A", sA]]) {
    console.log(`${id.padEnd(6)} | ${s.metricas.logLoss.toFixed(4)} | ${s.metricas.brier.toFixed(4)} | ${s.metricas.ece.toFixed(4)} | ${s.metricas.accuracy.toFixed(4)}    | ${s.sumaPE} | ${s.ll.empates}`);
  }
  console.log(`Δ (A−V1): LL ${dLL} | Brier ${dBrier} | ECE ${dECE} | Acc ${dAcc}`);
  console.log(`Pareado: media ΔLL ${pareado.mediaDeltaLL} (IC95 [${pareado.ic95[0]}, ${pareado.ic95[1]}], significativo=${pareado.significativo}); ganaA ${pareado.ganaA} / ganaV1 ${pareado.ganaV1}`);
  console.log(`Real: ${sV1.real.home} L / ${sV1.real.draw} E / ${sV1.real.away} V | V1 aciertos ${Math.round(sV1.metricas.accuracy * n)} · A ${Math.round(sA.metricas.accuracy * n)}`);
  console.log(`Composición 0-0/1-1/2-2 obs V1-esp: 0-0 ${sV1.composicion.observado["0-0"]}/${sV1.composicion.esperado["0-0"]} · 1-1 ${sV1.composicion.observado["1-1"]}/${sV1.composicion.esperado["1-1"]}`);
  console.log(`\nDECISIÓN (pre-registrada): ${decision}`);

  // items por partido (auditoría)
  const items = test.map((p, i) => ({
    id: p.id, fecha: dia(p), marcador: `${p.goalsH}-${p.goalsA}`, real: realDe(p), liga: p.liga,
    probsV1: evV1.predicciones[i].probs, probsA: evA.predicciones[i].probs,
    llV1: r4(llDe(evV1.predicciones[i])), llA: r4(llDe(evA.predicciones[i])),
  }));

  const informe = {
    generado: new Date().toISOString(),
    nota: "FASE 4 — evaluación ÚNICA en TEST (378). V1 en TEST ya estaba registrado en backtest.test desde Fase 1 (réplica como sanidad); la evaluación de A es PRIMERA y única, sin shopping de variantes. Modelos refit sobre TV (1523, ≤2026-06-18); Elo TEST en pasada cronológica con ratings previos. Criterio pre-registrado en la cabecera del script.",
    splits: { train: json.backtest.split.train.n, val: json.backtest.split.val.n, test: json.backtest.split.test.n, rangoTest: [dia(test[0]), dia(test[test.length - 1])] },
    sanidades,
    backtestTestRegistradoFase1: { accuracy: bt.accuracy, logLoss: bt.logLoss, brier: bt.brier, ece: bt.ece, baselineTest: json.backtest.baselineTest },
    modelos: {
      V1: { desc: modelos.V1.desc, metricas: sV1.metricas, ll: sV1.ll, nEmpates: sV1.nEmpates, sumaPE: sV1.sumaPE, composicion: sV1.composicion, real: sV1.real },
      A: { desc: modelos.A.desc, beta: a.beta, metricas: sA.metricas, ll: sA.ll, nEmpates: sA.nEmpates, sumaPE: sA.sumaPE, composicion: sA.composicion, real: sA.real },
    },
    deltas: { dLL, dBrier, dECE, dAcc },
    pareado,
    criterio: { promocion: "ΔLL≤−0.005 y ΔBrier≤0 y ΔAcc≥−0.005 y ΔECE≤+0.005", marginal: "−0.005<ΔLL<0 → no promover", noMejora: "ΔLL≥0 → mantener V1" },
    decision,
    items,
  };
  const ruta = guardarInforme4("fase4_1_test.json", informe);
  console.log(`\nInforme: ${ruta}`);
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message || e); process.exit(1); });
