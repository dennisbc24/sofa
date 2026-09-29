// ---------------------------------------------------------------------------
// FASE 3.8 — CAPAS DE CALIBRACIÓN DE EMPATE (M0/M1/M2) sobre V1.
// EXCLUSIVO DE INVESTIGACIÓN. NADA va a producción; TEST NO se carga.
//
// REGLAS PRE-REGISTRADAS (escritas ANTES de ejecutar):
//  - Base: V1 (ganador de TEST en Fase 4). Mismo dataset, mismos splits
//    oficiales, mismas 5 ventanas rolling día-estricto, cero leakage.
//  - Variantes: M0 (Platt P(E), diagnóstico), M1 (logística de empate con
//    |ΔElo|, λh+λa y tasa de empates previa por liga), M2 (softmax 6 clases
//    {H,0-0,1-1,2-2,otrosE,V}). Capas ajustadas SÓLO con partidos del fit de
//    cada ventana, vía cross-fit temporal (3 pliegues crecientes: el 30% inicial
//    del fit no produce preds para la capa; los preds de entrenamiento de la
//    capa son fuera de muestra respecto de sus modelos base).
//  - Señales/features sin fuga: Elo cronológico previo (TV), tasa de liga con
//    corte día estricto, λ del modelo base correspondiente.
//  - Criterio idéntico a fases 3.6/3.7 (7 señales sobre eval/OOF 762):
//      s1 ΔLL<0, s2 ΔLL empate<0, s3 ΔBrier≤0, s4 ΔECE empate ≤ +0.0005,
//      s5 composición 0-0/1-1/2-2 (Σ|obs−esp|) mejora, s6 ≥3/4 ventanas,
//      s7 sin deterioro H/A (tol +0.002); candidato = s1 && s2 && s7 && ≥5.
//  - RESULTADO: sólo marca "candidato experimental". El TEST ya fue consumido
//    (Fase 4); la confirmación de un candidato sería con partidos futuros
//    (> 2026-09-27). Sin shopping: estas 3 variantes son las únicas.
//  - Producción (V1_BETA, JSON, endpoints) intacta.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { calcularElo } = require("../experimentos/elo");
const { calcularMetricas } = require("../services/prediccion/backtest");
const { aPorcentajes } = require("../services/prediccion/modelo_poisson");
const {
  predsBase, construirFElo, construirFLiga,
  ajustarM1, aplicarM1, ajustarM2, aplicarM2, celdaTrasCapa,
} = require("./capas_empate");
const {
  CLASES, r4, pct, argmax, dia, cargarTV, construirVentanas, evaluarExp,
  extendidas, llSubconjunto, guardarInforme,
} = require("./comun");

// ---- utilidades (copia de fase3_6_dixoncoles.js) --------------------------
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const mediana = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function eceBinario(pares, ancho = 10) {
  const n = pares.length;
  const nBins = Math.ceil(100 / ancho);
  const bins = Array.from({ length: nBins }, () => ({ s: 0, o: 0, n: 0 }));
  for (const { prob, obs } of pares) {
    const b = Math.min(nBins - 1, Math.floor(prob / ancho));
    bins[b].s += prob; bins[b].o += obs; bins[b].n += 1;
  }
  const filas = bins.map((b, i) => ({
    rango: `${i * ancho}-${(i + 1) * ancho}%`, n: b.n,
    probProm: b.n ? b.s / b.n : null, frecReal: b.n ? b.o / b.n : null,
  })).filter((b) => b.n > 0);
  const ece = n ? filas.reduce((a, b) => a + (b.n / n) * Math.abs(b.frecReal - b.probProm / 100), 0) : null;
  return { filas, ece: ece === null ? null : r4(ece) };
}
const brierBinario = (pares) => r4(media(pares.map(({ prob, obs }) => (prob / 100 - obs) ** 2)));
const paresDraw = (preds) => preds.map((p) => ({ prob: p.probs.draw, obs: p.real === "draw" ? 1 : 0 }));
const cel = (marc) => marc.split("-").map(Number);
const cellKey = (x, y) => `${x}-${y}`;
const CELDAS = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [2, 1], [1, 2], [2, 2], [3, 3]];
const d4 = (a, b) => (a - b >= 0 ? "+" : "") + (a - b).toFixed(4);
const MODELOS = ["V1", "M0", "M1", "M2"];

// corte día estricto dentro del fit (para los pliegues cross-fit)
const cortarDia = (arr, frac) => {
  let i = Math.max(1, Math.min(arr.length - 1, Math.floor(arr.length * frac)));
  while (i < arr.length && dia(arr[i - 1]) === dia(arr[i])) i += 1;
  return i;
};

(async () => {
  console.log("=========== FASE 3.8 — CAPAS DE CALIBRACIÓN DE EMPATE · solo TRAIN+VAL (TEST no cargado) ===========");
  console.log("Base: V1 (producción). Variantes: M0 (diag), M1, M2. Criterio 7 señales idéntico a 3.6/3.7.");
  const { TV, nTrain, valHasta } = await cargarTV(pool);
  const antes = calcularElo(TV, { k: 32 }).antes;
  const fElo = construirFElo(antes);
  const fLiga = construirFLiga(TV);
  const augTV = TV.map((p, i) => ({ ...p, fElo: fElo[i], fLiga: fLiga[i], eloHome: antes[i].home, eloAway: antes[i].away }));
  const { oficial, ventanas } = construirVentanas(augTV, nTrain);
  console.log(`TV ${TV.length} (nTrain=${nTrain}) — SQL filtra fecha <= ${valHasta}`);
  console.log(`ventanas idénticas: OFICIAL fit ${oficial.fit.length} eval ${oficial.eval.length} | W1-4 eval ${ventanas.map((w) => w.eval.length).join("/")}`);

  // ---- por ventana: cross-fit de la capa + evaluación ----------------------
  const R = { V1: { ventanas: {} }, M0: { ventanas: {} }, M1: { ventanas: {} }, M2: { ventanas: {} } };
  const params = { V1: null, M0: {}, M1: {}, M2: {} };
  const rawPooled = [], salPooled = { M0: [], M1: [], M2: [] };
  let okCross = true, okCoef = true, okNll = true;
  for (const win of [oficial, ...ventanas]) {
    // pliegues crecientes day-strict: [0,30%)→pred [30,50); [0,50%)→pred [50,75%); [0,75%)→pred [75%,100%)
    const c1 = cortarDia(win.fit, 0.3), c2 = cortarDia(win.fit, 0.5), c3 = cortarDia(win.fit, 0.75);
    if (!(c1 < c2 && c2 < c3)) throw new Error(`pliegues cross-fit inválidos en ${win.nombre} (${c1}/${c2}/${c3})`);
    const cross = [
      { fit: win.fit.slice(0, c1), ev: win.fit.slice(c1, c2) },
      { fit: win.fit.slice(0, c2), ev: win.fit.slice(c2, c3) },
      { fit: win.fit.slice(0, c3), ev: win.fit.slice(c3) },
    ];
    const layerData = [];
    for (const cf of cross) {
      const m = entrenarExp(cf.fit, "SPEC30");
      layerData.push(...predsBase(m, cf.ev));
    }
    const baseFinal = entrenarExp(win.fit, "SPEC30");
    const evV1 = evaluarExp(baseFinal, win.eval);            // V1 redondeado (comparable)
    const rawEval = predsBase(baseFinal, win.eval);           // CRUDO para capas

    // fuga: los datos de la capa deben ser estrictamente anteriores al eval
    const maxCapa = layerData.reduce((m, it) => (dia(it) > m ? dia(it) : m), "");
    const minEval = win.eval.reduce((m, p) => (dia(p) < m ? dia(p) : m), "9999-99-99");
    if (!(maxCapa < minEval)) okCross = false;

    const pM0 = ajustarM1(layerData, { soloBase: true });
    const pM1 = ajustarM1(layerData, { soloBase: false });
    const pM2 = ajustarM2(layerData);
    params.M0[win.nombre] = pM0; params.M1[win.nombre] = pM1; params.M2[win.nombre] = pM2;
    if (!(pM0.nllFinal < pM0.nll0) || !(pM1.nllFinal < pM1.nll0) || !(pM2.nllFinal < pM2.nll0)) okNll = false;
    const finitos = (arr) => arr.every((v) => Number.isFinite(v));
    if (!finitos([pM0.a, ...pM0.w, pM1.a, ...pM1.w, ...pM2.A, ...pM2.B, ...pM2.C, ...pM2.D, ...pM2.E])) okCoef = false;

    const sal0 = rawEval.map((r) => aplicarM1(pM0, r));
    const sal1 = rawEval.map((r) => aplicarM1(pM1, r));
    const sal2 = rawEval.map((r) => aplicarM2(pM2, r));
    const predsDe = (salidas) => rawEval.map((r, i) => ({
      fecha: r.fecha, id: r.id, home: r.home, away: r.away, liga: r.liga,
      lambdaHome: r.lh, lambdaAway: r.la,
      probs: aPorcentajes(salidas[i].pH, salidas[i].pE, salidas[i].pV, 1),
      real: r.real, marcador: r.marcador,
    }));
    const porModelo = { V1: evV1.predicciones, M0: predsDe(sal0), M1: predsDe(sal1), M2: predsDe(sal2) };
    for (const id of MODELOS) {
      R[id].ventanas[win.nombre] = {
        metricas: calcularMetricas(porModelo[id]),
        items: win.eval.map((m, i) => ({ m, pred: porModelo[id][i] })),
      };
    }
    if (win.nombre !== "OFICIAL") {
      rawPooled.push(...rawEval);
      salPooled.M0.push(...sal0); salPooled.M1.push(...sal1); salPooled.M2.push(...sal2);
    }
    console.log(`  ✓ ${win.nombre}: fit ${win.fit.length} → capa con ${layerData.length} cross-fit preds (eval ${win.eval.length})`);
  }
  for (const id of MODELOS) R[id].items = ventanas.flatMap((w) => R[id].ventanas[w.nombre].items);
  const pooled = (id) => R[id].items.map((x) => x.pred);
  const predsV1 = pooled("V1");
  const nPooled = predsV1.length;

  // ---- SANIDADES -----------------------------------------------------------
  const f4prev = JSON.parse(fs.readFileSync(path.join(__dirname, "informes", "fase3_4_af.json"), "utf8"));
  const f3prev = JSON.parse(fs.readFileSync(path.join(__dirname, "informes", "fase3_3_experimentos.json"), "utf8"));
  const v1Pooled = calcularMetricas(predsV1);
  const v1Of = R.V1.ventanas.OFICIAL.metricas;
  const ok1 = v1Pooled.logLoss === f4prev.modelos.V1.pooled.logLoss
    && v1Pooled.accuracy === f4prev.modelos.V1.pooled.accuracy
    && v1Pooled.brier === f4prev.modelos.V1.pooled.brier
    && v1Pooled.ece === f4prev.modelos.V1.pooled.ece;
  const ok2 = v1Of.logLoss === f4prev.modelos.V1.porVentana.OFICIAL.logLoss
    && v1Of.accuracy === f4prev.modelos.V1.porVentana.OFICIAL.accuracy;
  const ok3 = JSON.stringify(f3prev.ventanas.map((v) => [v.fit, v.eval, v.desde, v.hasta]))
    === JSON.stringify(ventanas.map((w) => [w.fit.length, w.eval.length, dia(w.eval[0]), dia(w.eval[w.eval.length - 1])]));
  const maxFecha = dia(ventanas[ventanas.length - 1].eval[ventanas[ventanas.length - 1].eval.length - 1]);
  const ok4 = maxFecha <= valHasta;
  // identidades exactas de las capas
  const muestra = rawPooled.slice(0, 200);
  const idM1 = muestra.every((r) => {
    const s = aplicarM1({ a: 0, w: [1, 0, 0, 0], soloBase: false }, r);
    return Math.abs(s.pE - r.pE) < 1e-15 && Math.abs(s.pH + s.pE + s.pV - 1) < 1e-14;
  });
  const idM2 = muestra.every((r) => {
    const s = aplicarM2({ A: [0, 0, 0, 0, 0, 0], B: [1, 1, 1, 1, 1, 1], C: [0, 0, 0, 0, 0, 0], D: [0, 0, 0, 0, 0, 0], E: [0, 0, 0, 0, 0, 0] }, r);
    return CLASES.every((c) => Math.abs(s[c === "home" ? "pH" : c === "draw" ? "pE" : "pV"] - (c === "home" ? r.pH : c === "draw" ? r.pE : r.pV)) < 1e-12)
      && Math.abs(s.pH + s.pE + s.pV - 1) < 1e-12;
  });
  let okProbs = true;
  for (const id of MODELOS) for (const p of pooled(id)) {
    if (p.probs.home + p.probs.draw + p.probs.away !== 100 || p.probs.home < 0 || !Number.isFinite(p.probs.draw)) okProbs = false;
  }
  const sanidad = {
    v1PooledIgualFase34: ok1, v1OficialIgualFase34: ok2, ventanasIguales: ok3,
    testNoCargado: ok4, identidadM1: idM1, identidadM2: idM2,
    capaNllMejora: okCross ? okNll : false, coeficientesFinitos: okCoef,
    crossFitSinFuga: okCross, probsValidas: okProbs,
  };
  console.log("\nSANIDADES:");
  const nombres = {
    v1PooledIgualFase34: "V1 pooled (762) == fase3_4 (LL 1.1100 + acc/brier/ece)",
    v1OficialIgualFase34: "V1/OFICIAL == fase3_4 (LL 1.0751)",
    ventanasIguales: "ventanas idénticas a fase3_3",
    testNoCargado: `TEST no cargado (última eval ${maxFecha} ≤ ${valHasta})`,
    identidadM1: "M1 con params neutros reproduce la base exactamente (1e-15)",
    identidadM2: "M2 con params neutros reproduce la base exactamente (1e-12)",
    capaNllMejora: "la capa mejora su NLL in-sample en los datos cross-fit (optimizador OK)",
    coeficientesFinitos: "coeficientes finitos en todas las ventanas",
    crossFitSinFuga: "datos de la capa estrictamente anteriores al eval (day-strict)",
    probsValidas: "probs válidas en todos los preds (suma=100, ≥0, finitas)",
  };
  for (const [k, v] of Object.entries(sanidad)) console.log(`  ${nombres[k]}: ${v ? "SÍ ✓" : "NO ✗"}`);
  if (Object.values(sanidad).some((x) => !x)) throw new Error("Sanidades FALLIDAS — detener.");
  console.log(`pooled OOF: ${nPooled} preds | empates reales: ${predsV1.filter((p) => p.real === "draw").length} (${pct(predsV1.filter((p) => p.real === "draw").length / nPooled, 1)})`);

  // ---- TABLA GLOBAL --------------------------------------------------------
  const G = {};
  for (const id of MODELOS) {
    const preds = pooled(id);
    const e = extendidas(preds);
    G[id] = {
      metricas: calcularMetricas(preds),
      porClase: Object.fromEntries(CLASES.map((c) => [c, {
        recall: e.por[c].recall === null ? null : r4(e.por[c].recall),
        precision: e.por[c].precision === null ? null : r4(e.por[c].precision),
      }])),
      cnt: e.cnt, prom: e.prom,
    };
  }
  console.log("\n--- TABLA GLOBAL (pooled 762) · V1 vs capas ---");
  console.log("Modelo | Accuracy | LogLoss | Brier  | ECE    | recall H | recall E | recall A");
  for (const id of MODELOS) {
    const g = G[id];
    console.log(`${id.padEnd(6)} | ${pct(g.metricas.accuracy)} | ${g.metricas.logLoss.toFixed(4)} | ${g.metricas.brier.toFixed(4)} | ${g.metricas.ece.toFixed(4)} | ${pct(g.porClase.home.recall, 1)}   | ${pct(g.porClase.draw.recall, 1)}   | ${pct(g.porClase.away.recall, 1)}`);
  }
  for (const id of ["M0", "M1", "M2"]) {
    console.log(`Δ (${id}−V1): LL ${d4(G[id].metricas.logLoss, G.V1.metricas.logLoss)} | Brier ${d4(G[id].metricas.brier, G.V1.metricas.brier)} | ECE ${d4(G[id].metricas.ece, G.V1.metricas.ece)} | Acc ${d4(G[id].metricas.accuracy, G.V1.metricas.accuracy)}`);
  }

  // ---- MÉTRICAS DEL EMPATE -------------------------------------------------
  const D = {};
  for (const id of MODELOS) {
    const preds = pooled(id);
    const draws = preds.filter((p) => p.real === "draw");
    const noDraws = preds.filter((p) => p.real !== "draw");
    const e = extendidas(preds);
    D[id] = {
      llEmpates: llSubconjunto(preds, "draw"),
      brierE: brierBinario(paresDraw(preds)),
      eceE: eceBinario(paresDraw(preds)).ece,
      recallE: r4(e.por.draw.recall), precisionE: r4(e.por.draw.precision),
      pEmedia: r4(media(preds.map((p) => p.probs.draw))),
      pEnEmpates: r4(media(draws.map((p) => p.probs.draw))),
      pEnNoEmpates: r4(media(noDraws.map((p) => p.probs.draw))),
      argmaxE: e.cnt.draw,
    };
    D[id].separacion = r4(D[id].pEnEmpates - D[id].pEnNoEmpates);
  }
  console.log("\n--- MÉTRICAS DEL EMPATE (pooled 762) ---");
  console.log("métrica                     | V1       | M0       | M1       | M2");
  const fD = (et, f) => console.log(`${et.padEnd(27)} | ${String(f("V1")).padStart(8)} | ${String(f("M0")).padStart(8)} | ${String(f("M1")).padStart(8)} | ${String(f("M2")).padStart(8)}`);
  fD("LL clase empate", (id) => D[id].llEmpates);
  fD("ECE empate", (id) => D[id].eceE);
  fD("Brier empate", (id) => D[id].brierE);
  fD("P(E) media", (id) => D[id].pEmedia + "%");
  fD("P(E) en empates", (id) => D[id].pEnEmpates + "%");
  fD("P(E) en no-empates", (id) => D[id].pEnNoEmpates + "%");
  fD("separación (emp−no)", (id) => D[id].separacion);
  fD("argmax=E", (id) => D[id].argmaxE);

  // ---- COMPOSICIÓN 0-0/1-1/2-2 --------------------------------------------
  const obsM = Object.fromEntries(CELDAS.map(([x, y]) => [cellKey(x, y), 0]));
  const extraObs = { otros: 0 };
  for (const r of rawPooled) {
    const [x, y] = cel(r.marcador);
    const k = cellKey(x, y);
    if (k in obsM) obsM[k] += 1;
    else if (x === y) extraObs.otros += 1;
  }
  const espM = { V1: {}, M0: {}, M1: {}, M2: {} };
  for (const id of MODELOS) for (const [x, y] of CELDAS) espM[id][cellKey(x, y)] = 0;
  rawPooled.forEach((r, i) => {
    const salV1 = { pH: r.pH, pE: r.pE, pV: r.pV };
    for (const [x, y] of CELDAS) espM.V1[cellKey(x, y)] += celdaTrasCapa(r, salV1, x, y);
    for (const [x, y] of CELDAS) espM.M0[cellKey(x, y)] += celdaTrasCapa(r, salPooled.M0[i], x, y);
    for (const [x, y] of CELDAS) espM.M1[cellKey(x, y)] += celdaTrasCapa(r, salPooled.M1[i], x, y);
    for (const [x, y] of CELDAS) espM.M2[cellKey(x, y)] += celdaTrasCapa(r, salPooled.M2[i], x, y);
  });
  console.log("\n--- COMPOSICIÓN DE EMPATES (esperado = Σ P(celda) sobre 762) ---");
  console.log("| Marcador | Observado | Esp V1  | Esp M1  | Esp M2  |");
  const filasComp = CELDAS.filter(([x, y]) => x === y).map(([x, y]) => {
    const k = cellKey(x, y);
    const fila = { marcador: k, observado: obsM[k], espV1: r4(espM.V1[k]), espM0: r4(espM.M0[k]), espM1: r4(espM.M1[k]), espM2: r4(espM.M2[k]) };
    console.log(`| ${k.padEnd(8)} | ${String(fila.observado).padStart(9)} | ${String(fila.espV1).padStart(7)} | ${String(fila.espM1).padStart(8)} | ${String(fila.espM2).padStart(8)} |`);
    return fila;
  });
  const errComp = (id) => CELDAS.filter(([x, y]) => x === y).reduce((a, [x, y]) => a + Math.abs(obsM[cellKey(x, y)] - espM[id][cellKey(x, y)]), 0);
  const err10 = (id) => CELDAS.reduce((a, [x, y]) => a + Math.abs(obsM[cellKey(x, y)] - espM[id][cellKey(x, y)]), 0);
  const ERR = Object.fromEntries(MODELOS.map((id) => [id, { diag: r4(errComp(id)), total10: r4(err10(id)) }]));
  console.log(`error Σ|obs−esp| (0-0/1-1/2-2/3-3): V1 ${ERR.V1.diag} | M0 ${ERR.M0.diag} | M1 ${ERR.M1.diag} | M2 ${ERR.M2.diag} (10 celdas: V1 ${ERR.V1.total10} → M2 ${ERR.M2.total10})`);
  console.log(`(empates otros ≥4-4 observados: ${extraObs.otros})`);

  // ---- VENTANAS ------------------------------------------------------------
  console.log("\n--- POR VENTANA · Log Loss (negativo = la capa gana) ---");
  console.log("| Modelo | W1 | W2 | W3 | W4 | Pooled | OFICIAL |");
  const porVentana = {};
  for (const id of MODELOS) {
    const cells = ventanas.map((w) => R[id].ventanas[w.nombre].metricas.logLoss);
    const pooledLL = calcularMetricas(pooled(id)).logLoss;
    porVentana[id] = { cells: cells.map(r4), pooled: r4(pooledLL), oficial: r4(R[id].ventanas.OFICIAL.metricas.logLoss) };
    console.log(`| ${id.padEnd(6)} | ${cells.map((c) => c.toFixed(4)).join(" | ")} | ${pooledLL.toFixed(4)} | ${R[id].ventanas.OFICIAL.metricas.logLoss.toFixed(4)} |`);
  }

  // ---- CRITERIO (7 señales, idéntico a 3.6/3.7) ---------------------------
  const llH = (id) => r4(calcularMetricas(pooled(id).filter((p) => p.real === "home")).logLoss);
  const llA = (id) => r4(calcularMetricas(pooled(id).filter((p) => p.real === "away")).logLoss);
  const criterios = {};
  for (const id of ["M1", "M2"]) {
    let gana = 0;
    ventanas.forEach((w, i) => { if (porVentana[id].cells[i] < porVentana.V1.cells[i]) gana += 1; });
    const senales = {
      s1_ll_global: G[id].metricas.logLoss < G.V1.metricas.logLoss,
      s2_ll_empate: D[id].llEmpates < D.V1.llEmpates,
      s3_brier: G[id].metricas.brier <= G.V1.metricas.brier,
      s4_ece: D[id].eceE <= D.V1.eceE + 0.0005,
      s5_composicion: ERR[id].diag < ERR.V1.diag,
      s6_consistencia: gana >= 3,
      s7_ha_no_deteriora: llH(id) <= llH("V1") + 0.002 && llA(id) <= llA("V1") + 0.002,
    };
    const nSenales = Object.values(senales).filter(Boolean).length;
    const candidato = senales.s1_ll_global && senales.s2_ll_empate && senales.s7_ha_no_deteriora && nSenales >= 5;
    const veredicto = candidato
      ? `${id} MEJORA a V1 en eval/OOF → CANDIDATO EXPERIMENTAL (NO producción; confirmación con partidos futuros > 2026-09-27, TEST consumido).`
      : `${id} NO es mejora clara sobre V1 (${nSenales}/7 señales) → DESCARTAR; mantener V1.`;
    criterios[id] = { senales, nSenales, candidato, veredicto, ganaVentanas: gana, llH: { V1: llH("V1"), [id]: llH(id) }, llAway: { V1: llA("V1"), [id]: llA(id) } };
    console.log(`\n--- CRITERIO ${id} vs V1 (7 señales) ---`);
    console.log(`1. LL global (${d4(G[id].metricas.logLoss, G.V1.metricas.logLoss)}): ${senales.s1_ll_global ? "SÍ ✓" : "NO ✗"}`);
    console.log(`2. LL empate (${d4(D[id].llEmpates, D.V1.llEmpates)}): ${senales.s2_ll_empate ? "SÍ ✓" : "NO ✗"}`);
    console.log(`3. Brier (${d4(G[id].metricas.brier, G.V1.metricas.brier)}): ${senales.s3_brier ? "SÍ ✓" : "NO ✗"}`);
    console.log(`4. ECE empate (${d4(D[id].eceE, D.V1.eceE)}): ${senales.s4_ece ? "SÍ ✓" : "NO ✗"}`);
    console.log(`5. composición (${ERR.V1.diag} → ${ERR[id].diag}): ${senales.s5_composicion ? "SÍ ✓" : "NO ✗"}`);
    console.log(`6. consistencia (${gana}/4 ventanas): ${senales.s6_consistencia ? "SÍ ✓" : "NO ✗"}`);
    console.log(`7. H/A sin deterioro (H ${llH("V1")}→${llH(id)}; A ${llA("V1")}→${llA(id)}): ${senales.s7_ha_no_deteriora ? "SÍ ✓" : "NO ✗"}`);
    console.log(`→ ${nSenales}/7 → ${veredicto}`);
  }

  // ---- INFORME -------------------------------------------------------------
  const informe = {
    generado: new Date().toISOString(),
    nota: "FASE 3.8 — capas de calibración de empate sobre V1. Investigación exclusiva: NO producción, NO TEST (SQL ≤ fin de VAL), sin shopping (M0/M1/M2 pre-registradas). Capas ajustadas con cross-fit temporal dentro del fit de cada ventana (3 pliegues crecientes day-strict); features sin fuga (Elo cronológico, tasa de liga día estricto). Criterio idéntico a 3.6/3.7 sobre eval/OOF. TEST consumido en Fase 4: un candidato se confirmaría con partidos futuros > 2026-09-27.",
    formula: {
      M0: "logit P(E)' = a + b·logit P(E)",
      M1: "logit P(E)' = a + b·logit P(E) + c·|ΔElo|/400 + d·(λh+λa) + e·tasaEmpatesLiga(previa); masa (1−P(E)) → H/V proporcionales",
      M2: "softmax 6 clases {H,0-0,1-1,2-2,otrosE,V}: l_k = a_k + b_k·log p_k(base) + c_k·|ΔElo|/400 + d_k·(λh+λa) + e_k·tasaLiga",
      crossFit: "la capa se entrena con preds fuera de muestra (pliegues crecientes 30/50/75% del fit); el modelo base final (fit completo) sólo genera preds de eval",
      estimacion: "GD con backtracking, NLL + L2=0.01 (logística binaria / multinomial convexas); determinista",
    },
    sanidad,
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: dia(w.eval[0]), hasta: dia(w.eval[w.eval.length - 1]) })),
    coeficientes: {
      M0: params.M0, M1: params.M1, M2: params.M2,
      nota: "por ventana; nll0 = NLL identidad, nllFinal = NLL tras ajuste (sólo evidencia in-sample del optimizador, NO de mejora fuera de muestra)",
    },
    secciones: {
      global: Object.fromEntries(MODELOS.map((id) => [id, { metricas: G[id].metricas, cnt: G[id].cnt, prom: G[id].prom, porClase: G[id].porClase }])),
      deltasVsV1: Object.fromEntries(["M0", "M1", "M2"].map((id) => [id, {
        ll: r4(G[id].metricas.logLoss - G.V1.metricas.logLoss), brier: r4(G[id].metricas.brier - G.V1.metricas.brier),
        ece: r4(G[id].metricas.ece - G.V1.metricas.ece), acc: r4(G[id].metricas.accuracy - G.V1.metricas.accuracy),
      }])),
      empate: D,
      composicion: { filas: filasComp, otrosEmpates: extraObs.otros, errorDiagonal: ERR, observado: obsM, esperado: espM },
      ventanas: porVentana,
      criterio: criterios,
    },
    items: rawPooled.map((r, i) => ({
      fecha: dia(r), marcador: r.marcador, real: r.real, liga: r.liga,
      pV1: [predsV1[i].probs.home, predsV1[i].probs.draw, predsV1[i].probs.away],
      pM1: [salPooled.M1[i].pH, salPooled.M1[i].pE, salPooled.M1[i].pV].map((v) => r4(v)),
      pM2: [salPooled.M2[i].pH, salPooled.M2[i].pE, salPooled.M2[i].pV].map((v) => r4(v)),
    })),
  };
  const ruta = guardarInforme("fase3_8_capas.json", informe);
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("NOTA: ninguna capa va a producción en este experimento.");
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message || e); process.exit(1); });
