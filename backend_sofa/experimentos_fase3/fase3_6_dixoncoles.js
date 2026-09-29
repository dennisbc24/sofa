// ---------------------------------------------------------------------------
// EXPERIMENTO 1 — DIXON-COLES (DC-A = V1 + Elo K=32 + corrección DC).
// EXCLUSIVO DE INVESTIGACIÓN. NADA de esto va a producción.
//
// REGLAS DE ORO:
//  - NO tocar V1_BETA, prediccion_poisson.json, endpoints ni frontend.
//  - TEST no se carga (SQL fecha <= fin de VAL). Solo TRAIN+VALIDATION.
//  - Mismos splits (fechas oficiales), mismas 5 ventanas rolling día-estricto,
//    mismo dataset y cero leakage que fases 3.1–3.5.
//  - Modelo base: A = V1 + Elo K=32 (entrenarConFeatures SPEC30 conElo).
//    Única modificación: τ de Dixon-Coles sobre la matriz conjunta.
//    λs de A congelados (ρ es el único parámetro estimado).
//  - ρ se estima por MLE sólo con los partidos del FIT de cada ventana
//    (OFICIAL: TRAIN; W1-4: su fit). Nunca con datos de eval.
//  - Sin Davidson, Platt, temperatura, umbrales, multiplicadores, reglas
//    por liga/equipo, híbridos ni otras variables.
//  - Sanidad exigida: con ρ=0, DC-A debe reproducir A exactamente.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarConFeatures } = require("../experimentos/modelo_elo_exp");
const { calcularElo } = require("../experimentos/elo");
const { calcularMetricas } = require("../services/prediccion/backtest");
const { tau, matrizNorm, probsDC, rangoAdmisible, ajustarRho } = require("./dixoncoles");
const {
  CLASES, r4, pct, argmax, dia, cargarTV, construirVentanas, evaluarExp,
  extendidas, llSubconjunto, guardarInforme,
} = require("./comun");

// ---- utilidades (copia de fase3_5_empates.js) ------------------------------
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
const CELDAS_LL = CELDAS.filter(([x, y]) => !(x === 3 && y === 3));
const celdaPred = (p, x, y) => matrizNorm(p.lambdaHome, p.lambdaAway, p.rho ?? 0).mat[x][y];

(async () => {
  console.log("=========== EXPERIMENTO 1 — DIXON-COLES (DC-A) · solo TRAIN+VAL (TEST no cargado) ===========");
  console.log("Investigación aislada: producción/V1_BETA/JSON no se tocan. Sin Davidson/Platt/umbrales.");
  const { TV, nTrain, valHasta } = await cargarTV(pool);
  console.log(`TV ${TV.length} (nTrain=${nTrain}) — SQL filtra fecha <= ${valHasta}`);
  const { antes } = calcularElo(TV, { k: 32 });
  const augTV = TV.map((p, i) => ({ ...p, eloHome: antes[i].home, eloAway: antes[i].away }));
  const { oficial, ventanas } = construirVentanas(augTV, nTrain);
  console.log(`ventanas idénticas: OFICIAL fit ${oficial.fit.length} eval ${oficial.eval.length} | W1-4 eval ${ventanas.map((w) => w.eval.length).join("/")}`);

  // ---- por ventana: entrenar A, estimar ρ en fit, evaluar A y DC-A ---------
  const R = { A: { ventanas: {} }, DC: { ventanas: {} } };
  const rhos = {};
  let okRho0 = true, okTauEval = true;
  let sumaMalA = 0, sumaMalDC = 0, negA = 0, negDC = 0, nanA = 0, nanDC = 0;
  for (const win of [oficial, ...ventanas]) {
    const modelo = entrenarConFeatures(win.fit, "SPEC30", { conElo: true });
    const evFit = evaluarExp(modelo, win.fit);
    const evEval = evaluarExp(modelo, win.eval);
    const rango = rangoAdmisible(evFit.predicciones.map((p) => ({ lh: p.lambdaHome, la: p.lambdaAway })));
    const low = evFit.predicciones
      .filter((p) => { const [x, y] = cel(p.marcador); return x <= 1 && y <= 1; })
      .map((p) => { const [x, y] = cel(p.marcador); return { x, y, lh: p.lambdaHome, la: p.lambdaAway }; });
    const ajuste = ajustarRho(low, rango);
    rhos[win.nombre] = { rho: ajuste.rho, llRho: r4(ajuste.llRho), ll0: r4(ajuste.ll0), rango: { lo: r4(ajuste.rango.lo), hi: r4(ajuste.rango.hi) }, nLow: low.length, nFit: win.fit.length, enBorde: ajuste.enBorde };
    const rho = ajuste.rho;

    const predsDC = evEval.predicciones.map((p) => {
      for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) if (!(tau(x, y, p.lambdaHome, p.lambdaAway, rho) > 0)) okTauEval = false;
      const q = probsDC(p.lambdaHome, p.lambdaAway, 0);
      if (q.home !== p.probs.home || q.draw !== p.probs.draw || q.away !== p.probs.away) okRho0 = false;
      const d = probsDC(p.lambdaHome, p.lambdaAway, rho);
      if (d.home + d.draw + d.away !== 100) sumaMalDC += 1;
      if (d.home < 0 || d.draw < 0 || d.away < 0) negDC += 1;
      if (!Number.isFinite(d.home) || !Number.isFinite(d.draw) || !Number.isFinite(d.away)) nanDC += 1;
      if (p.probs.home + p.probs.draw + p.probs.away !== 100) sumaMalA += 1;
      if (p.probs.home < 0 || p.probs.draw < 0 || p.probs.away < 0) negA += 1;
      if (!Number.isFinite(p.probs.home) || !Number.isFinite(p.probs.draw) || !Number.isFinite(p.probs.away)) nanA += 1;
      return { ...p, probs: d, rho };
    });
    R.A.ventanas[win.nombre] = { metricas: evEval.metricas, items: win.eval.map((m, i) => ({ m, pred: evEval.predicciones[i] })) };
    R.DC.ventanas[win.nombre] = { metricas: calcularMetricas(predsDC), items: win.eval.map((m, i) => ({ m, pred: predsDC[i] })) };
  }
  for (const id of ["A", "DC"]) R[id].items = ventanas.flatMap((w) => R[id].ventanas[w.nombre].items);
  const pooled = (id) => R[id].items.map((x) => x.pred);
  const predsA = pooled("A"), predsDC = pooled("DC");
  const nPooled = predsA.length;
  const nEmpates = predsA.filter((p) => p.real === "draw").length;

  // ---- SANIDADES -----------------------------------------------------------
  const prev = JSON.parse(fs.readFileSync(path.join(__dirname, "informes", "fase3_3_experimentos.json"), "utf8"));
  const aOf = R.A.ventanas.OFICIAL.metricas;
  const aPooled = calcularMetricas(predsA);
  const ok1 = Math.abs(aOf.logLoss - 1.0686) < 1e-9
    && aOf.accuracy === prev.modelos.A.oficial.accuracy
    && aOf.brier === prev.modelos.A.oficial.brier
    && aOf.ece === prev.modelos.A.oficial.ece;
  const ok2 = aPooled.logLoss === prev.modelos.A.pooled.logLoss
    && aPooled.accuracy === prev.modelos.A.pooled.accuracy
    && aPooled.brier === prev.modelos.A.pooled.brier
    && aPooled.ece === prev.modelos.A.pooled.ece;
  const ok3 = okRho0;
  const ok4 = JSON.stringify(prev.ventanas.map((v) => [v.fit, v.eval, v.desde, v.hasta]))
    === JSON.stringify(ventanas.map((w) => [w.fit.length, w.eval.length, dia(w.eval[0]), dia(w.eval[w.eval.length - 1])]));
  const ok5 = sumaMalA === 0 && sumaMalDC === 0 && negA === 0 && negDC === 0 && nanA === 0 && nanDC === 0 && okTauEval;
  const maxFecha = dia(ventanas[ventanas.length - 1].eval[ventanas[ventanas.length - 1].eval.length - 1]);
  const ok6 = maxFecha <= valHasta;
  console.log(`\nSANIDAD 1 · A/OFICIAL == fase3_3 (LL 1.0686 + acc/brier/ece): ${ok1 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 2 · A pooled (762) == fase3_3/3.4 (LL 1.1045 + acc/brier/ece): ${ok2 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 3 · ρ=0 reproduce A exactamente (${nPooled}×2 preds): ${ok3 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 4 · ventanas idénticas a fase3_3: ${ok4 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 5 · probs válidas (suma=100, ≥0, finitas) + τ>0 en eval: ${ok5 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 6 · TEST no cargado (última fecha eval ${maxFecha} ≤ ${valHasta}): ${ok6 ? "SÍ ✓" : "NO ✗"}`);
  if (!ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6) throw new Error("Sanidad fallida — detener.");
  console.log(`pooled OOF: ${nPooled} preds | empates reales: ${nEmpates} (${pct(nEmpates / nPooled, 1)})`);
  console.log("ρ̂ por ventana (rango = intersección de cotas de todos los partidos del fit):");
  for (const [w, r] of Object.entries(rhos)) {
    console.log(`  ${w}: ρ̂=${r4(r.rho).toFixed(4)} rango=(${r.rango.lo.toFixed(4)}, ${r.rango.hi.toFixed(4)}) nFit=${r.nFit} nLow=${r.nLow} ll(ρ̂)−ll(0) in-sample=${r4(r.llRho - r.ll0).toFixed(4)}`);
  }
  console.log("NOTA: ll(ρ̂)−ll(0) es evidencia SÓLO in-sample del MLE; la decisión DC-A vs A se decide con eval/OOF (762 + ventanas).");

  // ---- TABLA GLOBAL --------------------------------------------------------
  const G = {};
  for (const id of ["A", "DC"]) {
    const preds = pooled(id);
    const m = calcularMetricas(preds);
    const e = extendidas(preds);
    G[id] = {
      metricas: m,
      porClase: Object.fromEntries(CLASES.map((c) => [c, {
        recall: e.por[c].recall === null ? null : r4(e.por[c].recall),
        precision: e.por[c].precision === null ? null : r4(e.por[c].precision),
        f1: e.por[c].f1 === null ? null : r4(e.por[c].f1),
      }])),
      cnt: e.cnt, prom: e.prom,
    };
  }
  const d4 = (a, b) => (a - b >= 0 ? "+" : "") + (a - b).toFixed(4);
  console.log("\n--- TABLA GLOBAL (pooled 762) · A vs DC-A ---");
  console.log("Modelo | Accuracy | LogLoss | Brier  | ECE    | Rec H  | Rec E  | Rec A  | Prec H | Prec E | Prec A | F1 H   | F1 E   | F1 A");
  for (const id of ["A", "DC"]) {
    const g = G[id], pc = g.porClase;
    console.log(`${id.padEnd(6)} | ${pct(g.metricas.accuracy)} | ${g.metricas.logLoss.toFixed(4)} | ${g.metricas.brier.toFixed(4)} | ${g.metricas.ece.toFixed(4)} | ${pct(pc.home.recall, 1)} | ${pct(pc.draw.recall, 1)} | ${pct(pc.away.recall, 1)} | ${pct(pc.home.precision, 1)} | ${pct(pc.draw.precision, 1)} | ${pct(pc.away.precision, 1)} | ${pct(pc.home.f1, 1)} | ${pct(pc.draw.f1, 1)} | ${pct(pc.away.f1, 1)}`);
  }
  const dLL = d4(G.DC.metricas.logLoss, G.A.metricas.logLoss);
  const dBrier = d4(G.DC.metricas.brier, G.A.metricas.brier);
  const dECE = d4(G.DC.metricas.ece, G.A.metricas.ece);
  const dAcc = d4(G.DC.metricas.accuracy, G.A.metricas.accuracy);
  console.log(`Δ (DC−A): ΔLL ${dLL} | ΔBrier ${dBrier} | ΔECE ${dECE} | ΔAcc ${dAcc}  (negativo = mejora)`);

  // ---- MÉTRICAS ESPECÍFICAS DEL EMPATE -------------------------------------
  const D = {};
  for (const id of ["A", "DC"]) {
    const preds = pooled(id);
    const draws = preds.filter((p) => p.real === "draw");
    const noDraws = preds.filter((p) => p.real !== "draw");
    const e = extendidas(preds);
    const pEs = preds.map((p) => p.probs.draw);
    D[id] = {
      llEmpates: llSubconjunto(preds, "draw"),
      brierE: brierBinario(paresDraw(preds)),
      eceE: eceBinario(paresDraw(preds)).ece,
      recallE: r4(e.por.draw.recall), precisionE: r4(e.por.draw.precision), f1E: r4(e.por.draw.f1),
      pEmedia: r4(media(pEs)), pEmediana: r4(mediana(pEs)),
      pEnEmpates: r4(media(draws.map((p) => p.probs.draw))),
      pEnNoEmpates: r4(media(noDraws.map((p) => p.probs.draw))),
      argmaxE: e.cnt.draw,
    };
    D[id].separacion = r4(D[id].pEnEmpates - D[id].pEnNoEmpates);
  }
  console.log("\n--- MÉTRICAS ESPECÍFICAS DEL EMPATE (pooled 762) ---");
  console.log("métrica                       | A         | DC-A");
  const fD = (et, a, b) => console.log(`${et.padEnd(29)} | ${String(a).padStart(9)} | ${String(b).padStart(9)}`);
  fD("LL clase empate", D.A.llEmpates, D.DC.llEmpates);
  fD("Brier binario empate", D.A.brierE, D.DC.brierE);
  fD("ECE específico empate", D.A.eceE, D.DC.eceE);
  fD("recall E", D.A.recallE, D.DC.recallE);
  fD("precision E", D.A.precisionE, D.DC.precisionE);
  fD("F1 E", D.A.f1E, D.DC.f1E);
  fD("P(E) media", D.A.pEmedia + "%", D.DC.pEmedia + "%");
  fD("P(E) mediana", D.A.pEmediana + "%", D.DC.pEmediana + "%");
  fD("P(E) en empates reales", D.A.pEnEmpates + "%", D.DC.pEnEmpates + "%");
  fD("P(E) en NO empates", D.A.pEnNoEmpates + "%", D.DC.pEnNoEmpates + "%");
  fD("separación (emp−no)", D.A.separacion + " pts", D.DC.separacion + " pts");
  fD("empates predichos argmax", D.A.argmaxE, D.DC.argmaxE);

  // ---- MATRIZ DE MARCADORES ------------------------------------------------
  const obsM = {};
  for (const [x, y] of CELDAS) obsM[cellKey(x, y)] = 0;
  const extraObs = { otros: 0 };
  for (const p of predsA) {
    const [x, y] = cel(p.marcador);
    const k = cellKey(x, y);
    if (k in obsM) obsM[k] += 1;
    else if (x === y) extraObs.otros += 1;
  }
  const espM = { A: {}, DC: {} };
  for (const id of ["A", "DC"]) for (const [x, y] of CELDAS) espM[id][cellKey(x, y)] = 0;
  predsA.forEach((p) => { for (const [x, y] of CELDAS) espM.A[cellKey(x, y)] += celdaPred(p, x, y); });
  predsDC.forEach((p) => { for (const [x, y] of CELDAS) espM.DC[cellKey(x, y)] += celdaPred(p, x, y); });
  console.log("\n--- MATRIZ DE MARCADORES (esperado = Σ P(celda) sobre 762) ---");
  console.log("| Marcador | Observado | Esperado A | Esperado DC-A | Δ DC−A |");
  const filasMatriz = CELDAS.map(([x, y]) => {
    const k = cellKey(x, y);
    const fila = { marcador: k, observado: obsM[k], esperadoA: r4(espM.A[k]), esperadoDC: r4(espM.DC[k]), delta: r4(espM.DC[k] - espM.A[k]) };
    console.log(`| ${k.padEnd(8)} | ${String(fila.observado).padStart(9)} | ${String(fila.esperadoA).padStart(10)} | ${String(fila.esperadoDC).padStart(12)} | ${(fila.delta >= 0 ? "+" : "") + fila.delta.toFixed(2).padStart(6)} |`);
    return fila;
  });
  console.log(`(empates "otros" ≥4-4 observados: ${extraObs.otros})`);
  const errComp = (esp) => CELDAS.filter(([x, y]) => x === y).reduce((a, [x, y]) => a + Math.abs(obsM[cellKey(x, y)] - esp[cellKey(x, y)]), 0);
  const errCompA = r4(errComp(espM.A)), errCompDC = r4(errComp(espM.DC));
  const errComp10 = (esp) => CELDAS.reduce((a, [x, y]) => a + Math.abs(obsM[cellKey(x, y)] - esp[cellKey(x, y)]), 0);
  const errComp10A = r4(errComp10(espM.A)), errComp10DC = r4(errComp10(espM.DC));
  const ceroCero = filasMatriz.find((f) => f.marcador === "0-0"), unouno = filasMatriz.find((f) => f.marcador === "1-1"), dosdos = filasMatriz.find((f) => f.marcador === "2-2");
  console.log(`0-0: obs ${ceroCero.observado} | A ${ceroCero.esperadoA} → DC ${ceroCero.esperadoDC} (Δ ${d4(ceroCero.esperadoDC, ceroCero.esperadoA)}) | error |obs−exp|: A ${r4(Math.abs(ceroCero.observado - ceroCero.esperadoA))} → DC ${r4(Math.abs(ceroCero.observado - ceroCero.esperadoDC))}`);
  console.log(`1-1: obs ${unouno.observado} | A ${unouno.esperadoA} → DC ${unouno.esperadoDC} (Δ ${d4(unouno.esperadoDC, unouno.esperadoA)}) | error |obs−exp|: A ${r4(Math.abs(unouno.observado - unouno.esperadoA))} → DC ${r4(Math.abs(unouno.observado - unouno.esperadoDC))}`);
  console.log(`2-2: obs ${dosdos.observado} | A ${dosdos.esperadoA} → DC ${dosdos.esperadoDC} (Δ ${d4(dosdos.esperadoDC, dosdos.esperadoA)})`);
  console.log(`error composición (empates 0-0/1-1/2-2): A ${errCompA} → DC ${errCompDC} | (10 celdas) A ${errComp10A} → DC ${errComp10DC}`);

  // ---- LOG LOSS POR MARCADOR ----------------------------------------------
  console.log("\n--- LOG LOSS POR MARCADOR (sobre los partidos con esa puntuación) ---");
  console.log("| Marcador | n  | LL A    | LL DC-A | Δ       |");
  const llPorMarcador = [];
  for (const [x, y] of CELDAS_LL) {
    const k = cellKey(x, y);
    const idxs = predsA.map((p, i) => i).filter((i) => predsA[i].marcador === k);
    if (!idxs.length) { console.log(`| ${k.padEnd(8)} |  0 | —       | —       | —       |`); continue; }
    const llA = media(idxs.map((i) => -Math.log(Math.max(1e-15, celdaPred(predsA[i], x, y)))));
    const llD = media(idxs.map((i) => -Math.log(Math.max(1e-15, celdaPred(predsDC[i], x, y)))));
    llPorMarcador.push({ marcador: k, n: idxs.length, llA: r4(llA), llDC: r4(llD), delta: r4(llD - llA) });
    console.log(`| ${k.padEnd(8)} | ${String(idxs.length).padStart(2)} | ${llA.toFixed(4)} | ${llD.toFixed(4)} | ${d4(llD, llA)} |`);
  }

  // ---- CALIBRACIÓN P(E) ----------------------------------------------------
  const CAL = {};
  for (const id of ["A", "DC"]) {
    const c = eceBinario(paresDraw(pooled(id)));
    CAL[id] = { filas: c.filas.map((f) => ({ rango: f.rango, n: f.n, pEprom: r4(f.probProm), frecReal: r4(f.frecReal), error: r4((f.frecReal - f.probProm / 100) * 100), empates: Math.round(f.frecReal * f.n) })), ece: c.ece, brier: brierBinario(paresDraw(pooled(id))) };
  }
  console.log("\n--- CALIBRACIÓN ESPECÍFICA P(E) (bins 10 pts) · A vs DC-A ---");
  console.log("| Bucket  | N_A | Emp A | Frec A | P(E)A  | Err A  | N_DC | Emp DC | Frec DC | P(E)DC | Err DC |");
  const mapaCal = (id) => Object.fromEntries(CAL[id].filas.map((f) => [f.rango, f]));
  const mapA = mapaCal("A"), mapD = mapaCal("DC");
  for (let i = 0; i < 10; i++) {
    const rango = `${i * 10}-${(i + 1) * 10}%`;
    const a = mapA[rango], d = mapD[rango];
    if (!a && !d) continue;
    const fmt = (f, key) => (f ? String(f[key]) : "—");
    console.log(`| ${rango.padEnd(7)} | ${fmt(a, "n").padStart(3)} | ${fmt(a, "empates").padStart(5)} | ${a ? pct(a.frecReal, 1) : "—".padStart(6)} | ${a ? pct(a.pEprom / 100, 1) : "—".padStart(6)} | ${a ? ((a.error >= 0 ? "+" : "") + a.error.toFixed(1)) : "—".padStart(5)} | ${fmt(d, "n").padStart(4)} | ${fmt(d, "empates").padStart(6)} | ${d ? pct(d.frecReal, 1) : "—".padStart(7)} | ${d ? pct(d.pEprom / 100, 1) : "—".padStart(6)} | ${d ? ((d.error >= 0 ? "+" : "") + d.error.toFixed(1)) : "—".padStart(5)} |`);
  }
  console.log(`ECE empate: A ${CAL.A.ece} → DC ${CAL.DC.ece} | Brier empate: A ${CAL.A.brier} → DC ${CAL.DC.brier}`);

  // ---- EMPATES REALES (200) ------------------------------------------------
  const empIdx = predsA.map((p, i) => i).filter((i) => predsA[i].real === "draw");
  const ED = { A: {}, DC: {} };
  for (const id of ["A", "DC"]) {
    const preds = pooled(id);
    const sub = empIdx.map((i) => preds[i]);
    const maxP = sub.map((p) => Math.max(p.probs.home, p.probs.draw, p.probs.away));
    ED[id] = {
      pH: r4(media(sub.map((p) => p.probs.home))),
      pE: r4(media(sub.map((p) => p.probs.draw))),
      pA: r4(media(sub.map((p) => p.probs.away))),
      pMax: r4(media(maxP)),
      gap: r4(media(maxP.map((mx, i) => mx - sub[i].probs.draw))),
      lh: r4(media(sub.map((p) => p.lambdaHome))),
      la: r4(media(sub.map((p) => p.lambdaAway))),
    };
  }
  console.log("\n--- EMPATES REALES (n=200) ---");
  console.log("modelo | P(H)   | P(E)   | P(A)   | P(max) | gap max−P(E) | λL    | λV");
  for (const id of ["A", "DC"]) {
    const x = ED[id];
    console.log(`${id.padEnd(6)} | ${pct(x.pH / 100, 1)} | ${pct(x.pE / 100, 1)} | ${pct(x.pA / 100, 1)} | ${pct(x.pMax / 100, 1)} | ${String(x.gap).padStart(12)} | ${x.lh.toFixed(3)} | ${x.la.toFixed(3)}`);
  }
  const detalleEmp = empIdx.map((i) => ({
    fecha: dia(R.A.items[i].m), liga: R.A.items[i].m.liga, home: R.A.items[i].m.home, away: R.A.items[i].m.away,
    marcador: predsA[i].marcador,
    A: { pH: predsA[i].probs.home, pE: predsA[i].probs.draw, pA: predsA[i].probs.away, gap: Math.max(predsA[i].probs.home, predsA[i].probs.draw, predsA[i].probs.away) - predsA[i].probs.draw, lh: r4(predsA[i].lambdaHome), la: r4(predsA[i].lambdaAway) },
    DC: { pH: predsDC[i].probs.home, pE: predsDC[i].probs.draw, pA: predsDC[i].probs.away, gap: Math.max(predsDC[i].probs.home, predsDC[i].probs.draw, predsDC[i].probs.away) - predsDC[i].probs.draw, lh: r4(predsDC[i].lambdaHome), la: r4(predsDC[i].lambdaAway) },
  }));

  // ---- PARTIDOS NO EMPATADOS (obligatorio) --------------------------------
  const noEmpIdx = predsA.map((p, i) => i).filter((i) => predsA[i].real !== "draw");
  const NE = {};
  for (const id of ["A", "DC"]) {
    const preds = pooled(id);
    const sub = noEmpIdx.map((i) => preds[i]);
    const e = extendidas(preds);
    NE[id] = {
      n: sub.length,
      pEmedia: r4(media(sub.map((p) => p.probs.draw))),
      llNoEmpates: r4(calcularMetricas(sub).logLoss),
      falsosEmpates: sub.filter((p) => argmax(p.probs) === "draw").length,
      precisionE: r4(e.por.draw.precision),
    };
  }
  console.log("\n--- PARTIDOS NO EMPATADOS (obligatorio) ---");
  console.log("modelo | n   | P(E) media | LL no-empates | falsos empates (argmax E) | precision E");
  for (const id of ["A", "DC"]) {
    const x = NE[id];
    console.log(`${id.padEnd(6)} | ${String(x.n).padStart(3)} | ${pct(x.pEmedia / 100, 1).padStart(10)} | ${String(x.llNoEmpates).padStart(13)} | ${String(x.falsosEmpates).padStart(25)} | ${pct(x.precisionE, 1)}`);
  }

  // ---- ANÁLISIS POR GAP DE λ ----------------------------------------------
  const EDGEL = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 1.0], [1.0, 99]];
  const gapL = [];
  for (const [d, h] of EDGEL) {
    const idxs = predsA.map((p, i) => i).filter((i) => {
      const dl = Math.abs(predsA[i].lambdaHome - predsA[i].lambdaAway);
      return dl >= d && dl < h;
    });
    const fila = { bucket: `${d.toFixed(1)}-${h >= 99 ? "∞" : h.toFixed(1)}`, n: idxs.length, empates: idxs.filter((i) => predsA[i].real === "draw").length };
    fila.frecReal = fila.n ? r4(fila.empates / fila.n) : null;
    for (const id of ["A", "DC"]) {
      const preds = pooled(id);
      const sub = idxs.map((i) => preds[i]);
      fila[`pE_${id}`] = fila.n ? r4(media(sub.map((p) => p.probs.draw))) : null;
      fila[`ll_${id}`] = fila.n ? llSubconjunto(sub, "draw") : null;
      fila[`ece_${id}`] = fila.n ? eceBinario(paresDraw(sub)).ece : null;
    }
    gapL.push(fila);
    console.log(`\ngap |λL−λV| ${fila.bucket}: n=${fila.n} frec real E=${fila.n ? pct(fila.frecReal, 1) : "—"} | P(E): A ${fila.n ? pct(fila.pE_A / 100, 1) : "—"} / DC ${fila.n ? pct(fila.pE_DC / 100, 1) : "—"} | LL empate: A ${fila.ll_A} / DC ${fila.ll_DC} | ECE: A ${fila.ece_A} / DC ${fila.ece_DC}`);
  }

  // ---- ROLLING WINDOWS -----------------------------------------------------
  console.log("\n--- POR VENTANA · Log Loss (negativo = DC gana) ---");
  console.log("| Modelo | W1 | W2 | W3 | W4 | Pooled | OFICIAL |");
  const porVentana = {};
  for (const id of ["A", "DC"]) {
    const cells = ventanas.map((w) => R[id].ventanas[w.nombre].metricas.logLoss);
    const pooledLL = calcularMetricas(pooled(id)).logLoss;
    porVentana[id] = { cells, pooled: r4(pooledLL), oficial: R[id].ventanas.OFICIAL.metricas.logLoss };
    console.log(`| ${id.padEnd(6)} | ${cells.map((c) => c.toFixed(4)).join(" | ")} | ${pooledLL.toFixed(4)} | ${R[id].ventanas.OFICIAL.metricas.logLoss.toFixed(4)} |`);
  }
  let ganaDC = 0;
  ventanas.forEach((w, i) => { if (porVentana.DC.cells[i] < porVentana.A.cells[i]) ganaDC += 1; });
  const ganaOficial = porVentana.DC.oficial < porVentana.A.oficial;
  console.log(`DC-A gana a A en ${ganaDC}/4 ventanas rolling | OFICIAL: DC ${porVentana.DC.oficial.toFixed(4)} vs A ${porVentana.A.oficial.toFixed(4)} (${ganaOficial ? "gana" : "pierde"})`);
  console.log("\nSECUNDARIAS por ventana (Brier / ECE / Accuracy):");
  for (const id of ["A", "DC"]) {
    const partes = ventanas.map((w) => {
      const m = R[id].ventanas[w.nombre].metricas;
      return `${w.nombre} ${m.brier.toFixed(4)}/${m.ece.toFixed(4)}/${pct(m.accuracy)}`;
    });
    const mp = calcularMetricas(pooled(id));
    console.log(`  ${id.padEnd(6)} ${partes.join(" | ")} | POOLED ${mp.brier.toFixed(4)}/${mp.ece.toFixed(4)}/${pct(mp.accuracy)}`);
  }

  // ---- CRITERIO DE ÉXITO ---------------------------------------------------
  const llH_A = r4(calcularMetricas(predsA.filter((p) => p.real === "home")).logLoss);
  const llH_D = r4(calcularMetricas(predsDC.filter((p) => p.real === "home")).logLoss);
  const llA_A = r4(calcularMetricas(predsA.filter((p) => p.real === "away")).logLoss);
  const llA_D = r4(calcularMetricas(predsDC.filter((p) => p.real === "away")).logLoss);
  const senales = {
    s1_ll_global: G.DC.metricas.logLoss < G.A.metricas.logLoss,
    s2_ll_empate: D.DC.llEmpates < D.A.llEmpates,
    s3_brier: G.DC.metricas.brier <= G.A.metricas.brier,
    s4_ece: D.DC.eceE <= D.A.eceE + 0.0005,
    s5_composicion: errCompDC < errCompA,
    s6_consistencia: ganaDC >= 3,
    s7_ha_no_deteriora: llH_D <= llH_A + 0.002 && llA_D <= llA_A + 0.002,
  };
  const nSenales = Object.values(senales).filter(Boolean).length;
  const candidato = senales.s1_ll_global && senales.s2_ll_empate && senales.s7_ha_no_deteriora && nSenales >= 5;
  const veredicto = candidato
    ? "DC-A MEJORA A A en eval/OOF → candidato experimental (sigue SIN ir a producción)."
    : `DC-A NO es mejora clara sobre A (${nSenales}/7 señales; decisión sólo con eval/OOF) → DESCARTAR; mantener A.`;
  console.log("\n--- CRITERIO DE ÉXITO (7 señales) ---");
  console.log(`1. mejora LL global (${dLL}): ${senales.s1_ll_global ? "SÍ ✓" : "NO ✗"}`);
  console.log(`2. mejora LL empate (${d4(D.DC.llEmpates, D.A.llEmpates)}): ${senales.s2_ll_empate ? "SÍ ✓" : "NO ✗"}`);
  console.log(`3. mejora/estabilidad Brier (${dBrier}): ${senales.s3_brier ? "SÍ ✓" : "NO ✗"}`);
  console.log(`4. mejora/estabilidad ECE empate (${d4(D.DC.eceE, D.A.eceE)}): ${senales.s4_ece ? "SÍ ✓" : "NO ✗"}`);
  console.log(`5. mejor composición 0-0/1-1/2-2 (err A ${errCompA} → DC ${errCompDC}): ${senales.s5_composicion ? "SÍ ✓" : "NO ✗"}`);
  console.log(`6. consistencia ≥3/4 ventanas (${ganaDC}/4): ${senales.s6_consistencia ? "SÍ ✓" : "NO ✗"}`);
  console.log(`7. sin deterioro H/A (LL H: ${llH_A}→${llH_D}; LL A: ${llA_A}→${llA_D}): ${senales.s7_ha_no_deteriora ? "SÍ ✓" : "NO ✗"}`);
  console.log(`→ ${nSenales}/7 señales positivas → ${veredicto}`);
  console.log("NOTA: DC-A NO se convierte en producción en ningún caso de este experimento.");

  // ---- INFORME -------------------------------------------------------------
  const informe = {
    generado: new Date().toISOString(),
    nota: "EXPERIMENTO 1 Dixon-Coles — investigación exclusiva. NO producción, NO TEST, NO Davidson/Platt/umbrales. λs de A congelados; sólo ρ estimado por MLE en fit de cada ventana. Con ρ=0, DC-A ≡ A (sanidad).",
    formula: {
      tau: { "0-0": "1 − λh·λa·ρ", "0-1": "1 + λh·ρ", "1-0": "1 + λa·ρ", "1-1": "1 − ρ", resto: 1 },
      estimacion: "MLE condicional: max_ρ Σ log τ(x_i,y_i) sobre celdas ≤1 del fit (grid 4001 + refinamiento); sin decaimiento temporal (pesos uniformes)",
      datos: "sólo partidos del fit de cada ventana (OFICIAL=TRAIN; W1-4=su fit); jamás eval ni TEST",
      rango: "INTERSECCIÓN de cotas de todos los partidos del fit: rho_min = max_i(−1/max(λh_i,λa_i)), rho_max = min_i(1/(λh_i·λa_i)), rho < 1, con epsilon 1e-6 para no tocar τ=0",
      signo: "ρ<0 → 0-0 y 1-1 suben; ρ>0 → 0-0 y 1-1 bajan; restricción: se mueven juntos",
      notaDecision: "ll(ρ̂)−ll(0) es evidencia SÓLO in-sample (el MLE ajustó el fit). La decisión DC-A vs A se decide EXCLUSIVAMENTE con eval/OOF (762 OOF + ventanas W1-W4 + OFICIAL).",
    },
    sanidad: { aIgualOficial: ok1, aIgualFase33: ok2, rho0ReproduceA: ok3, ventanasIguales: ok4, probsValidas: ok5, testNoCargado: ok6 },
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: dia(w.eval[0]), hasta: dia(w.eval[w.eval.length - 1]) })),
    rho: { porVentana: rhos, nota: "llRho−ll0 = evidencia in-sample del MLE (NO es evidencia de mejora fuera de muestra); la mejora se mide en eval/OOF." },
    secciones: {
      global: { A: { metricas: { ...G.A.metricas, n: nPooled }, porClase: G.A.porClase, pred: G.A.cnt, prob: G.A.prom }, DC: { metricas: { ...G.DC.metricas, n: nPooled }, porClase: G.DC.porClase, pred: G.DC.cnt, prob: G.DC.prom }, delta: { ll: r4(G.DC.metricas.logLoss - G.A.metricas.logLoss), brier: r4(G.DC.metricas.brier - G.A.metricas.brier), ece: r4(G.DC.metricas.ece - G.A.metricas.ece), acc: r4(G.DC.metricas.accuracy - G.A.metricas.accuracy) } },
      empate: { A: D.A, DC: D.DC },
      matriz: { filas: filasMatriz, otrosEmpates: extraObs.otros, errorEmpates: { A: errCompA, DC: errCompDC }, error10Celdas: { A: errComp10A, DC: errComp10DC } },
      llPorMarcador,
      calibracion: CAL,
      empatesReales: { resumen: ED, detalle: detalleEmp },
      noEmpates: NE,
      gapLambda: gapL,
      ventanas: { A: { cells: porVentana.A.cells.map(r4), pooled: porVentana.A.pooled, oficial: r4(porVentana.A.oficial) }, DC: { cells: porVentana.DC.cells.map(r4), pooled: porVentana.DC.pooled, oficial: r4(porVentana.DC.oficial) }, ganaDC, ganaOficial },
      criterio: { senales, nSenales, candidato, veredicto, decisionBase: "exclusivamente eval/OOF (762 + ventanas); ll(ρ̂)−ll(0) in-sample NO cuenta", llH: { A: llH_A, DC: llH_D }, llAway: { A: llA_A, DC: llA_D } },
    },
  };
  const ruta = guardarInforme("fase3_6_dixoncoles.json", informe);
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO. Producción NO modificada. Validaciones externas de hashes/endpoints pendientes de ejecutar aparte.");
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
