// ---------------------------------------------------------------------------
// FASE 6 — CONFIRMACIÓN DE M1/M2 CON PARTIDOS FUTUROS (post-2026-09-27).
// PRE-REGISTRADO en 2026-09-28 ANTES de existir un solo partido futura.
// TEST (2026-06-19…2026-09-27) NO se carga: este bloque es un holdout nuevo.
//
// REGLAS:
//  - Sólo se ejecuta cuando haya ≥150 partidos Ended con fecha > 2026-09-27
//    (si no, aborta sin evaluar). Se evalúa UNA sola vez por cohorte.
//  - Modelos: V1 (refit TV=1523) + capas M0 (diag), M1, M2 — MISMA
//    configuración de despliegue pre-registrada: capa entrenada por
//    cross-fit temporal 30/50/75 sobre TODO TV (día estricto), modelo base
//    final = entrenarExp(TV). Features: Elo cronológico [...TV,...fut] y tasa
//    de liga día estricto (prefijo de TV idéntico a fase3_8).
//  - Criterio adaptado a bloque único (sin ventanas rolling): 6 señales
//    s1 ΔLL<0, s2 ΔLL empate<0, s3 ΔBrier≤0, s4 ΔECE empate ≤+0.0005,
//    s5 composición 0-0/1-1/2-2 mejora, s7 sin deterioro H/A (tol +0.002);
//    candidato = s1 && s2 && s7 && ≥4/6. (s6 de ventanas NO aplica.)
//  - Si un candidato confirma → SÓLO entonces plantear promoción al usuario
//    (toca archivos protegidos: requiere aprobación explícita + backup).
//  - Producción intacta; este script sólo ESCRIBE en informes/.
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
} = require("../experimentos_fase3/capas_empate");
const {
  CLASES, r4, pct, dia, cargarTV, evaluarExp, extendidas, llSubconjunto, modeloJson,
} = require("../experimentos_fase3/comun");

const MIN_FUTUROS = 150;
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function eceBinario(pares, ancho = 10) {
  const n = pares.length; const nBins = Math.ceil(100 / ancho);
  const bins = Array.from({ length: nBins }, () => ({ s: 0, o: 0, n: 0 }));
  for (const { prob, obs } of pares) { const b = Math.min(nBins - 1, Math.floor(prob / ancho)); bins[b].s += prob; bins[b].o += obs; bins[b].n += 1; }
  const filas = bins.map((b, i) => ({ rango: `${i * ancho}-${(i + 1) * ancho}%`, n: b.n, probProm: b.n ? b.s / b.n : null, frecReal: b.n ? b.o / b.n : null })).filter((b) => b.n > 0);
  const ece = n ? filas.reduce((a, b) => a + (b.n / n) * Math.abs(b.frecReal - b.probProm / 100), 0) : null;
  return { filas, ece: ece === null ? null : r4(ece) };
}
const paresDraw = (preds) => preds.map((p) => ({ prob: p.probs.draw, obs: p.real === "draw" ? 1 : 0 }));
const cel = (m) => m.split("-").map(Number);
const cellKey = (x, y) => `${x}-${y}`;
const CELDAS = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [2, 1], [1, 2], [2, 2], [3, 3]];
const MODELOS = ["V1", "M0", "M1", "M2"];
const cortarDia = (arr, frac) => {
  let i = Math.max(1, Math.min(arr.length - 1, Math.floor(arr.length * frac)));
  while (i < arr.length && dia(arr[i - 1]) === dia(arr[i])) i += 1;
  return i;
};

(async () => {
  console.log("=========== FASE 6 — CONFIRMACIÓN FUTURA (post-TEST) ===========");
  const json = modeloJson();
  const testHasta = json.backtest.split.test.hasta.slice(0, 10);
  const { TV, nTrain, valHasta } = await cargarTV(pool);
  if (TV.length !== json.backtest.split.train.n + json.backtest.split.val.n) throw new Error("DRIFT en TV — detener.");
  const { rows } = await pool.query(`
    SELECT id, fecha_partido, liga, equipo_local, equipo_visitante, goles_local, goles_visitante
    FROM partidos
    WHERE estado='Ended' AND fecha_partido IS NOT NULL
      AND goles_local IS NOT NULL AND goles_visitante IS NOT NULL
      AND fecha_partido > '${testHasta}'
    ORDER BY fecha_partido ASC, id ASC;`);
  const fut = rows.map((x) => ({
    id: x.id, fecha: x.fecha_partido, liga: x.liga, home: x.equipo_local, away: x.equipo_visitante,
    goalsH: x.goles_local, goalsA: x.goles_visitante,
  }));
  if (fut.length < MIN_FUTUROS) {
    console.log(`Sólo ${fut.length} partidos futuros (> ${testHasta}); se requieren ≥${MIN_FUTUROS}. Abortar sin evaluar (holdout intacto).`);
    process.exit(2);
  }
  console.log(`TV ${TV.length} | futuro ${fut.length} (${dia(fut[0])} … ${dia(fut[fut.length - 1])})`);

  // features: prefijo TV idéntico a fase3_8 (propiedad de prefijo de la pasada cronológica)
  const todo = [...TV, ...fut];
  const antes = calcularElo(todo, { k: 32 }).antes;
  const fElo = construirFElo(antes);
  const fLiga = construirFLiga(todo);
  const augTV = TV.map((p, i) => ({ ...p, fElo: fElo[i], fLiga: fLiga[i], eloHome: antes[i].home, eloAway: antes[i].away }));
  const augFut = fut.map((p, i) => ({ ...p, fElo: fElo[TV.length + i], fLiga: fLiga[TV.length + i], eloHome: antes[TV.length + i].home, eloAway: antes[TV.length + i].away }));
  if (dia(augFut[0]) <= testHasta) throw new Error("El bloque futuro invade el TEST — detener.");

  // capa cross-fit sobre TODO TV (configuración de despliegue pre-registrada)
  const c1 = cortarDia(augTV, 0.3), c2 = cortarDia(augTV, 0.5), c3 = cortarDia(augTV, 0.75);
  if (!(c1 < c2 && c3 <= augTV.length)) throw new Error("pliegues inválidos");
  const cross = [
    { fit: augTV.slice(0, c1), ev: augTV.slice(c1, c2) },
    { fit: augTV.slice(0, c2), ev: augTV.slice(c2, c3) },
    { fit: augTV.slice(0, c3), ev: augTV.slice(c3) },
  ];
  const layerData = [];
  for (const cf of cross) layerData.push(...predsBase(entrenarExp(cf.fit, "SPEC30"), cf.ev));
  const pM0 = ajustarM1(layerData, { soloBase: true });
  const pM1 = ajustarM1(layerData, { soloBase: false });
  const pM2 = ajustarM2(layerData);
  if (!(pM0.nllFinal < pM0.nll0 && pM1.nllFinal < pM1.nll0 && pM2.nllFinal < pM2.nll0)) throw new Error("capa no converge (NLL) — detener.");
  console.log(`capa entrenada con ${layerData.length} cross-fit preds de TV`);

  // evaluación única en el bloque futuro
  const base = entrenarExp(augTV, "SPEC30");
  const evV1 = evaluarExp(base, augFut);
  const raw = predsBase(base, augFut);
  const sal = { M0: raw.map((r) => aplicarM1(pM0, r)), M1: raw.map((r) => aplicarM1(pM1, r)), M2: raw.map((r) => aplicarM2(pM2, r)) };
  const predsDe = (s) => raw.map((r, i) => ({
    fecha: r.fecha, id: r.id, home: r.home, away: r.away, liga: r.liga,
    lambdaHome: r.lh, lambdaAway: r.la,
    probs: aPorcentajes(s[i].pH, s[i].pE, s[i].pV, 1), real: r.real, marcador: r.marcador,
  }));
  const P = { V1: evV1.predicciones, M0: predsDe(sal.M0), M1: predsDe(sal.M1), M2: predsDe(sal.M2) };
  let okProbs = true;
  for (const id of MODELOS) for (const p of P[id]) if (p.probs.home + p.probs.draw + p.probs.away !== 100 || !Number.isFinite(p.probs.draw)) okProbs = false;
  const idM1 = raw.slice(0, 100).every((r) => Math.abs(aplicarM1({ a: 0, w: [1, 0, 0, 0], soloBase: false }, r).pE - r.pE) < 1e-15);
  const idM2 = raw.slice(0, 100).every((r) => Math.abs(aplicarM2({ A: [0, 0, 0, 0, 0, 0], B: [1, 1, 1, 1, 1, 1], C: [0, 0, 0, 0, 0, 0], D: [0, 0, 0, 0, 0, 0], E: [0, 0, 0, 0, 0, 0] }, r).pE - r.pE) < 1e-12);
  const sanidad = { nFuturos: fut.length >= MIN_FUTUROS, sinTest: dia(augFut[0]) > testHasta, identidadM1: idM1, identidadM2: idM2, probsValidas: okProbs };
  console.log("sanidades:", JSON.stringify(sanidad));
  if (Object.values(sanidad).some((x) => !x)) throw new Error("sanidades FALLIDAS — no evaluar.");

  const G = Object.fromEntries(MODELOS.map((id) => [id, calcularMetricas(P[id])]));
  const D = Object.fromEntries(MODELOS.map((id) => {
    const preds = P[id];
    const draws = preds.filter((p) => p.real === "draw"), noD = preds.filter((p) => p.real !== "draw");
    const e = extendidas(preds);
    return [id, {
      llEmpates: llSubconjunto(preds, "draw"), eceE: eceBinario(paresDraw(preds)).ece,
      pEmedia: r4(media(preds.map((p) => p.probs.draw))),
      pEnEmpates: r4(media(draws.map((p) => p.probs.draw))), pEnNoEmpates: r4(media(noD.map((p) => p.probs.draw))),
      recallE: e.por.draw.recall === null ? null : r4(e.por.draw.recall), cnt: e.cnt,
    }];
  }));
  const obsM = Object.fromEntries(CELDAS.map(([x, y]) => [cellKey(x, y), 0]));
  for (const r of raw) { const [x, y] = cel(r.marcador); const k = cellKey(x, y); if (k in obsM) obsM[k] += 1; }
  const espM = { V1: {}, M0: {}, M1: {}, M2: {} };
  for (const id of MODELOS) for (const [x, y] of CELDAS) espM[id][cellKey(x, y)] = 0;
  raw.forEach((r, i) => {
    const idV = { pH: r.pH, pE: r.pE, pV: r.pV };
    for (const [x, y] of CELDAS) espM.V1[cellKey(x, y)] += celdaTrasCapa(r, idV, x, y);
    for (const [x, y] of CELDAS) espM.M0[cellKey(x, y)] += celdaTrasCapa(r, sal.M0[i], x, y);
    for (const [x, y] of CELDAS) espM.M1[cellKey(x, y)] += celdaTrasCapa(r, sal.M1[i], x, y);
    for (const [x, y] of CELDAS) espM.M2[cellKey(x, y)] += celdaTrasCapa(r, sal.M2[i], x, y);
  });
  const errDiag = (id) => CELDAS.filter(([x, y]) => x === y).reduce((a, [x, y]) => a + Math.abs(obsM[cellKey(x, y)] - espM[id][cellKey(x, y)]), 0);
  const llH = (id) => r4(calcularMetricas(P[id].filter((p) => p.real === "home")).logLoss);
  const llA = (id) => r4(calcularMetricas(P[id].filter((p) => p.real === "away")).logLoss);

  console.log("\n--- BLOQUE FUTURO (n=" + P.V1.length + ") ---");
  console.log("Modelo | LogLoss | Brier  | ECE    | Accuracy | LL empates | ECE empate | comp 0-0/1-1/2-2");
  for (const id of MODELOS) console.log(`${id.padEnd(6)} | ${G[id].logLoss.toFixed(4)} | ${G[id].brier.toFixed(4)} | ${G[id].ece.toFixed(4)} | ${G[id].accuracy.toFixed(4)}    | ${D[id].llEmpates} | ${D[id].eceE} | ${r4(errDiag(id))}`);

  const criterios = {};
  for (const id of ["M1", "M2"]) {
    const senales = {
      s1_ll_global: G[id].logLoss < G.V1.logLoss,
      s2_ll_empate: D[id].llEmpates < D.V1.llEmpates,
      s3_brier: G[id].brier <= G.V1.brier,
      s4_ece: D[id].eceE <= D.V1.eceE + 0.0005,
      s5_composicion: errDiag(id) < errDiag("V1"),
      s7_ha_no_deteriora: llH(id) <= llH("V1") + 0.002 && llA(id) <= llA("V1") + 0.002,
    };
    const nSenales = Object.values(senales).filter(Boolean).length;
    const candidato = senales.s1_ll_global && senales.s2_ll_empate && senales.s7_ha_no_deteriora && nSenales >= 4;
    criterios[id] = { senales, nSenales, candidato, veredicto: candidato ? `${id} CONFIRMADO en futuro → plantear promoción al usuario (aprobación explícita requerida)` : `${id} no confirma (${nSenales}/6) → mantener V1` };
    console.log(`\nCRITERIO ${id} (6 señales): ${Object.entries(senales).map(([k, v]) => `${k}=${v ? "✓" : "✗"}`).join(" ")} → ${nSenales}/6 → ${criterios[id].veredicto}`);
  }

  const informe = {
    generado: new Date().toISOString(),
    nota: "FASE 6 — confirmación de M0/M1/M2 sobre bloque futuro post-2026-09-27 (holdout nuevo; el TEST de Fase 4 NO se recarga). Criterio pre-registrado: 6 señales (s6 de ventanas no aplica a bloque único); candidato = s1 && s2 && s7 && ≥4/6.",
    bloques: { tv: TV.length, futuro: fut.length, desde: dia(fut[0]), hasta: dia(fut[fut.length - 1]) },
    sanidad,
    coeficientes: { M0: { a: pM0.a, w: pM0.w }, M1: { a: pM1.a, w: pM1.w }, M2: { A: pM2.A, B: pM2.B, C: pM2.C, D: pM2.D, E: pM2.E } },
    metricas: G, empate: D,
    composicion: { observado: obsM, esperado: espM, errorDiagonal: Object.fromEntries(MODELOS.map((id) => [id, r4(errDiag(id))])) },
    llH: Object.fromEntries(MODELOS.map((id) => [id, llH(id)])), llAway: Object.fromEntries(MODELOS.map((id) => [id, llA(id)])),
    criterio: criterios,
  };
  const dir = path.join(__dirname, "informes");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, "fase6_confirmacion.json");
  fs.writeFileSync(ruta, JSON.stringify(informe, null, 2));
  console.log(`\nInforme: ${ruta}`);
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message || e); process.exit(1); });
