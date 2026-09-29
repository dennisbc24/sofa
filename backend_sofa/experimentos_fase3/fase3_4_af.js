// ---------------------------------------------------------------------------
// FASE 3.4 — EXPERIMENTO ÚNICO: A+F = V1 + Elo(K=32) + localía ajustada.
//
// Pregunta: ¿la localía ajustada (F) aporta información adicional cuando el
// modelo ya conoce la diferencia de fuerza mediante Elo (A)? Fuera de muestra.
//
// REGLAS:
//  - No tocar V1_BETA, prediccion_poisson.json ni producción.
//  - TEST no se carga (SQL fecha <= fin de VAL). Solo TRAIN+VALIDATION.
//  - Mismos splits (fechas oficiales), mismas 5 ventanas rolling día-estricto,
//    mismo entrenamiento, Elo K=32, mismos hiperparámetros (SPEC30, 400 epochs,
//    lr 0.05, l2 0.05, l2Cov 0.01). Sin reglas manuales por liga.
//  - Único cambio respecto a A: agregar la covariable de localía (x_hfa = +1).
//    Implementación: entrenarConFeatures con conElo (Elo real) + conForma
//    donde formaHome=0.5 / formaAway=-0.5 → x_forma = +1 constante
//    (misma estructura ± γ que F, misma regularización l2Cov).
//  - Sin xG, tiros, remates, forma histórica ni otras variables.
//  - No se modifica el modelo de empates (solo se mide).
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { entrenarConFeatures } = require("../experimentos/modelo_elo_exp");
const { calcularElo } = require("../experimentos/elo");
const { evaluar, calcularMetricas } = require("../services/prediccion/backtest");
const {
  CLASES, r4, pct, cargarTV, construirVentanas, evaluarExp, extendidas,
  llSubconjunto, guardarInforme,
} = require("./comun");

// ---- MODELOS (train/eval idénticos a fase3_3) -------------------------------
const MODELOS = [
  { id: "V1", desc: "base V1 (SPEC30)", train: (f) => entrenarExp(f, "SPEC30"), ev: evaluar, map: (p) => p },
  { id: "A", desc: "V1 + Elo (K=32)", train: (f) => entrenarConFeatures(f, "SPEC30", { conElo: true }), ev: evaluarExp, map: (p) => p },
  { id: "F", desc: "V1 + localía ajustada (x=+1 vía Δelo ±200)", train: (f) => entrenarConFeatures(f, "SPEC30", { conElo: true }), ev: evaluarExp, map: (p) => ({ ...p, eloHome: 200, eloAway: -200 }) },
  { id: "AF", desc: "V1 + Elo (K=32) + localía ajustada", train: (f) => entrenarConFeatures(f, "SPEC30", { conElo: true, conForma: true }), ev: evaluarExp, map: mapAF },
];
// A+F: Elo real + x_hfa = formaHome - formaAway = 0.5 - (-0.5) = 1 constante.
function mapAF(p) { return { ...p, formaHome: 0.5, formaAway: -0.5 }; }

function resumen(preds) {
  const m = calcularMetricas(preds);
  const e = extendidas(preds);
  const cnt = { home: 0, draw: 0, away: 0 };
  for (const p of preds) cnt[p.real]++;
  const n = preds.length;
  return {
    metricas: m, ext: e,
    porClase: Object.fromEntries(CLASES.map((c) => [c, {
      recall: e.por[c].recall === null ? null : r4(e.por[c].recall),
      precision: e.por[c].precision === null ? null : r4(e.por[c].precision),
      f1: e.por[c].f1 === null ? null : r4(e.por[c].f1),
    }])),
    distPred: { home: r4(e.prom.home), draw: r4(e.prom.draw), away: r4(e.prom.away) },
    distReal: { home: r4(cnt.home / n), draw: r4(cnt.draw / n), away: r4(cnt.away / n) },
  };
}

(async () => {
  console.log("=========== FASE 3.4 — A+F (V1 + Elo + localía ajustada) · solo TRAIN+VAL ===========");
  const { TV, nTrain } = await cargarTV(pool);
  console.log(`TV ${TV.length} (nTrain=${nTrain}) — TEST no cargado`);

  const { antes } = calcularElo(TV, { k: 32 });
  const augTV = TV.map((p, i) => ({ ...p, eloHome: antes[i].home, eloAway: antes[i].away }));
  const { oficial, ventanas } = construirVentanas(augTV, nTrain);
  console.log(`ventanas idénticas: OFICIAL fit ${oficial.fit.length} eval ${oficial.eval.length} | W1-4 eval ${ventanas.map((w) => w.eval.length).join("/")}`);

  // ---- ejecutar 4 modelos sobre las mismas 5 ventanas ----
  const R = {}; // id → { ventanas, pooled, items, coef }
  const v1Modelos = {}; // ventana → modelo V1 (para buckets de fuerza comunes)
  let totalPreds = 0, sumaMal = 0, negativos = 0, nan = 0;
  for (const M of MODELOS) {
    R[M.id] = { ventanas: {}, desc: M.desc };
    for (const win of [oficial, ...ventanas]) {
      const modelo = M.train(win.fit.map(M.map));
      if (M.id === "V1") v1Modelos[win.nombre] = modelo;
      const ev = M.ev(modelo, win.eval.map(M.map));
      for (const p of ev.predicciones) {
        totalPreds++;
        const s = p.probs.home + p.probs.draw + p.probs.away;
        if (s !== 100) sumaMal++;
        if (p.probs.home < 0 || p.probs.draw < 0 || p.probs.away < 0) negativos++;
        if (!Number.isFinite(p.probs.home) || !Number.isFinite(p.probs.draw) || !Number.isFinite(p.probs.away)) nan++;
      }
      const items = win.eval.map((p, i) => ({ m: p, pred: ev.predicciones[i] }));
      R[M.id].ventanas[win.nombre] = { metricas: ev.metricas, items };
      if (M.id !== "V1") R[M.id].coef = R[M.id].coef || {}, R[M.id].coef[win.nombre] = { beta: modelo.beta ?? null, gamma: modelo.gamma ?? null };
    }
    const poolItems = ventanas.flatMap((w) => R[M.id].ventanas[w.nombre].items);
    R[M.id].items = poolItems;
    R[M.id].res = resumen(poolItems.map((x) => x.pred));
    console.log(`  ✓ ${M.id} (${M.desc}) — pooled LL ${R[M.id].res.metricas.logLoss.toFixed(4)}`);
  }

  // ---- SANIDADES ----
  const oficialJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8")).backtest.val;
  const v1of = R.V1.ventanas.OFICIAL.metricas;
  const ok1 = v1of.accuracy === oficialJson.accuracy && v1of.logLoss === oficialJson.logLoss && v1of.brier === oficialJson.brier;
  const ok2 = Math.abs(R.A.ventanas.OFICIAL.metricas.logLoss - 1.0686) < 1e-9;
  const prev = JSON.parse(fs.readFileSync(path.join(__dirname, "informes", "fase3_3_experimentos.json"), "utf8"));
  const ok3 = Math.abs(R.A.res.metricas.logLoss - prev.modelos.A.pooled.logLoss) < 1e-9
    && Math.abs(R.F.res.metricas.logLoss - prev.modelos.F.pooled.logLoss) < 1e-9
    && Math.abs(R.V1.res.metricas.logLoss - prev.modelos.V1.pooled.logLoss) < 1e-9;
  const ok4 = JSON.stringify(prev.ventanas.map((v) => [v.fit, v.eval, v.desde, v.hasta]))
    === JSON.stringify(ventanas.map((w) => [w.fit.length, w.eval.length, new Date(w.eval[0].fecha).toISOString().slice(0, 10), new Date(w.eval[w.eval.length - 1].fecha).toISOString().slice(0, 10)]));
  const ok5 = sumaMal === 0 && negativos === 0 && nan === 0;
  console.log(`\nSANIDAD 1 · V1/OFICIAL == modelo oficial JSON: ${ok1 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 2 · A/OFICIAL == fase_elo (1.0686): ${ok2 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 3 · V1/A/F pooled == fase3_3: ${ok3 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 4 · ventanas idénticas a fase3_3: ${ok4 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 5 · probabilidades válidas (${totalPreds} preds): suma=100 sin negativos/NaN: ${ok5 ? `SÍ ✓` : `NO ✗ (sumaMal=${sumaMal} neg=${negativos} nan=${nan})`}`);
  if (!ok1 || !ok2 || !ok5) throw new Error("Sanidades críticas fallidas — detener.");

  // ---- TABLA 1 · COMPARATIVA PRINCIPAL (pooled) ----
  const base = R.V1.res.metricas;
  const d4 = (a, b) => (a - b >= 0 ? "+" : "") + (a - b).toFixed(4);
  console.log("\n--- TABLA 1 · COMPARATIVA POOLED (762 preds fuera de muestra) ---");
  console.log("Modelo | Accuracy | LogLoss | Brier  | ECE    | Rec H  | Rec E  | Rec A  | Prec H | Prec E | Prec A | F1 H   | F1 E   | F1 A");
  const orden = ["V1", "A", "F", "AF"];
  for (const id of orden) {
    const r = R[id].res, pc = r.porClase;
    console.log(
      `${id.padEnd(6)} | ${pct(r.metricas.accuracy)} | ${r.metricas.logLoss.toFixed(4)} | ${r.metricas.brier.toFixed(4)} | ${r.metricas.ece.toFixed(4)} | ${pct(pc.home.recall, 1)} | ${pct(pc.draw.recall, 1)} | ${pct(pc.away.recall, 1)} | ${pct(pc.home.precision, 1)} | ${pct(pc.draw.precision, 1)} | ${pct(pc.away.precision, 1)} | ${pct(pc.home.f1, 1)} | ${pct(pc.draw.f1, 1)} | ${pct(pc.away.f1, 1)}`
    );
  }
  console.log("\nDistribución de predicciones argmax (n) y probabilidades medias:");
  console.log("Modelo | Pred H | Pred E | Pred A | P(H)   P(E)   P(A)   | real H/E/A");
  for (const id of orden) {
    const r = R[id].res, c = r.ext.cnt;
    console.log(`${id.padEnd(6)} | ${String(c.home).padStart(6)} | ${String(c.draw).padStart(6)} | ${String(c.away).padStart(6)} | ${pct(r.distPred.home, 1)}  ${pct(r.distPred.draw, 1)}  ${pct(r.distPred.away, 1)}  | ${pct(r.distReal.home, 1)}/${pct(r.distReal.draw, 1)}/${pct(r.distReal.away, 1)}`);
  }

  console.log("\n--- DELTAS (pooled) — negativo = mejora ---");
  console.log("Modelo | ΔLL vs V1 | ΔBrier vs V1 | ΔECE vs V1 | ΔAcc vs V1 | ΔLL vs A");
  for (const id of orden) {
    const m = R[id].res.metricas, a = R.A.res.metricas;
    console.log(`${id.padEnd(6)} | ${(m.logLoss - base.logLoss >= 0 ? "+" : "") + (m.logLoss - base.logLoss).toFixed(4).padStart(9)} | ${d4(m.brier, base.brier).padStart(12)} | ${d4(m.ece, base.ece).padStart(10)} | ${((m.accuracy - base.accuracy >= 0 ? "+" : "") + (m.accuracy - base.accuracy).toFixed(4)).padStart(10)} | ${id === "A" ? "  (base)" : d4(m.logLoss, a.logLoss).padStart(9)}`);
  }

  // ---- TABLA 2 · CONSISTENCIA POR VENTANA ----
  console.log("\n--- TABLA 2 · LOGLOSS POR VENTANA (principal) ---");
  console.log("| Modelo | W1 | W2 | W3 | W4 | Pooled |");
  console.log("| ------ | -: | -: | -: | -: | -----: |");
  const llWin = {};
  for (const id of orden) {
    const cells = ventanas.map((w) => R[id].ventanas[w.nombre].metricas.logLoss);
    llWin[id] = cells;
    console.log(`| ${id} | ${cells.map((c) => c.toFixed(4)).join(" | ")} | ${R[id].res.metricas.logLoss.toFixed(4)} |`);
  }
  console.log("\nSECUNDARIAS (pooled): Brier / ECE / Accuracy");
  for (const id of orden) {
    const m = R[id].res.metricas;
    console.log(`  ${id.padEnd(4)} ${m.brier.toFixed(4)} / ${m.ece.toFixed(4)} / ${pct(m.accuracy)}`);
  }
  const ganaVentanas = (x, y) => llWin[x].reduce((a, c, i) => a + (c < llWin[y][i] ? 1 : 0), 0);
  console.log(`\nVentanas donde AF gana a A: ${ganaVentanas("AF", "A")}/4 | donde AF gana a V1: ${ganaVentanas("AF", "V1")}/4 | OFICIAL: AF ${R.AF.ventanas.OFICIAL.metricas.logLoss.toFixed(4)} vs A ${R.A.ventanas.OFICIAL.metricas.logLoss.toFixed(4)}`);

  // ================= ANÁLISIS POR SEGMENTOS =================
  // Bucket común a los 4 modelos: Δfuerza = (att+def)_local − (att+def)_visita
  // del modelo V1 de CADA ventana (misma definición que fase3_1).
  const fuerza = []; // por índice pooled
  for (const w of ventanas) {
    const m = v1Modelos[w.nombre];
    w.eval.forEach((p) => {
      const fH = (m.att[p.home] ?? 0) + (m.def[p.home] ?? 0);
      const fA = (m.att[p.away] ?? 0) + (m.def[p.away] ?? 0);
      fuerza.push(fH - fA);
    });
  }
  const absF = [...fuerza].map(Math.abs).sort((a, b) => a - b);
  const q = [1, 2, 3, 4].map((i) => absF[Math.floor((i * absF.length) / 5)]);
  const t2 = absF[Math.floor((2 * absF.length) / 3)];
  const etqF = ["muy pequeña", "pequeña", "media", "grande", "muy grande"];
  const bucketF = (v) => { const a = Math.abs(v); let i = 0; while (i < q.length && a > q[i]) i++; return etqF[i]; };
  const bucketSup = (v) => (Math.abs(v) <= absF[Math.floor(absF.length / 3)] ? "equilibrados" : v > 0 ? (Math.abs(v) <= t2 ? "local ligeramente" : "local claramente") : (Math.abs(v) <= t2 ? "visita ligeramente" : "visita claramente"));

  // ---- TABLA 3 · BUCKETS DE DIFERENCIA DE FUERZA ----
  console.log(`\n--- TABLA 3 · BUCKETS |Δfuerza| (quintiles V1: ${q.map((x) => x.toFixed(3)).join(" / ")}) — ¿A+F mejora? ---`);
  console.log("bucket         | Mod  | n   | LL     | Brier | ECE    | Acc    | P(E)   | recall E | LL(empates)");
  const seg3 = {};
  for (const b of etqF) {
    seg3[b] = {};
    for (const id of orden) {
      const sub = R[id].items.filter((_, i) => bucketF(fuerza[i]) === b);
      const preds = sub.map((x) => x.pred);
      const m = calcularMetricas(preds);
      const e = extendidas(preds);
      const llE = llSubconjunto(preds, "draw");
      seg3[b][id] = { n: preds.length, accuracy: r4(m.accuracy), logLoss: r4(m.logLoss), brier: r4(m.brier), ece: r4(m.ece), pE: r4(e.prom.draw), recallE: e.por.draw.recall === null ? null : r4(e.por.draw.recall), llEmpates: llE };
      console.log(`${b.padEnd(14)} | ${id.padEnd(4)} | ${String(preds.length).padStart(3)} | ${m.logLoss.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.ece.toFixed(4)} | ${pct(m.accuracy)} | ${pct(e.prom.draw, 1)} | ${e.por.draw.recall === null ? "—" : pct(e.por.draw.recall, 1).padStart(8)} | ${llE === null ? "—" : llE.toFixed(4)}`);
    }
    const dLL = r4(seg3[b].AF.logLoss - seg3[b].A.logLoss);
    console.log(`${" ".repeat(14)} | ΔAF-A = ${dLL >= 0 ? "+" : ""}${dLL.toFixed(4)} ${dLL < 0 ? "← AF mejora" : "← AF no mejora"}`);
  }

  // ---- TABLA 4 · VISITANTE CLARAMENTE SUPERIOR ----
  const superiores = fuerza.map((v) => bucketSup(v) === "visita claramente");
  console.log(`\n--- TABLA 4 · VISITANTE CLARAMENTE SUPERIOR (Δ ≤ −${t2.toFixed(3)}) — ¿A+F corrige la subestimación local? ---`);
  console.log("Mod  | n   | LL     | Brier | ECE    | P(H)   | P(E)   | P(A)   | real H   | real E   | real A");
  const seg4 = {};
  for (const id of orden) {
    const sub = R[id].items.filter((_, i) => superiores[i]);
    const preds = sub.map((x) => x.pred);
    const m = calcularMetricas(preds);
    const e = extendidas(preds);
    const cnt = { home: 0, draw: 0, away: 0 };
    preds.forEach((p) => cnt[p.real]++);
    const n = preds.length;
    seg4[id] = { n, logLoss: r4(m.logLoss), brier: r4(m.brier), ece: r4(m.ece), pH: r4(e.prom.home), pE: r4(e.prom.draw), pA: r4(e.prom.away), realH: r4(cnt.home / n), realE: r4(cnt.draw / n), realA: r4(cnt.away / n) };
    console.log(`${id.padEnd(4)} | ${String(n).padStart(3)} | ${m.logLoss.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.ece.toFixed(4)} | ${pct(e.prom.home, 1)} | ${pct(e.prom.draw, 1)} | ${pct(e.prom.away, 1)} | ${pct(cnt.home / n, 1)} | ${pct(cnt.draw / n, 1)} | ${pct(cnt.away / n, 1)}`);
  }

  // ---- TABLA 5 · EMPATES (solo medir, no modificar) ----
  console.log("\n--- TABLA 5 · EMPATES (solo medir) ---");
  console.log("Mod  | LL(empate) | recall E | precision E | F1 E   | P(E) prom | P(E) prom en empates reales");
  const seg5 = {};
  for (const id of orden) {
    const preds = R[id].items.map((x) => x.pred);
    const llE = llSubconjunto(preds, "draw");
    const e = extendidas(preds);
    const drawsReales = preds.filter((p) => p.real === "draw");
    const pEDraws = drawsReales.reduce((a, p) => a + p.probs.draw, 0) / drawsReales.length / 100;
    seg5[id] = { llEmpates: r4(llE), recallE: e.por.draw.recall === null ? null : r4(e.por.draw.recall), precisionE: e.por.draw.precision === null ? null : r4(e.por.draw.precision), f1E: e.por.draw.f1 === null ? null : r4(e.por.draw.f1), pEProm: r4(e.prom.draw), pEDrawsReales: r4(pEDraws), nEmpatesReales: drawsReales.length };
    console.log(`${id.padEnd(4)} | ${llE.toFixed(4)}     | ${pct(e.por.draw.recall, 1)} | ${pct(e.por.draw.precision, 1)}    | ${pct(e.por.draw.f1, 1)} | ${pct(e.prom.draw, 1)}    | ${pct(pEDraws, 1)} (n=${drawsReales.length})`);
  }

  // ---- TABLA 6 · FAVORITOS EXTREMOS (calibración por P(max) propia de cada modelo) ----
  console.log("\n--- TABLA 6 · FAVORITOS EXTREMOS (buckets de P(max) propia; error = pred prom − frecuencia real del argmax) ---");
  const bins = [[0, 50], [50, 60], [60, 70], [70, 80], [80, 101]];
  const etiquetas = ["<50%", "50-60%", "60-70%", "70-80%", ">80%"];
  const seg6 = {};
  for (const id of orden) {
    seg6[id] = {};
    const preds = R[id].items.map((x) => x.pred);
    console.log(`  ${id}:`);
    console.log(`    bucket  | n   | P(max) prom | frec real argmax | error calibración`);
    bins.forEach(([lo, hi], i) => {
      const sub = preds.filter((p) => {
        const mx = Math.max(p.probs.home, p.probs.draw, p.probs.away);
        return mx >= lo && mx < hi;
      });
      if (!sub.length) { seg6[id][etiquetas[i]] = { n: 0 }; console.log(`    ${etiquetas[i].padEnd(7)} |   0 | —           | —                | —`); return; }
      const prom = sub.reduce((a, p) => a + Math.max(p.probs.home, p.probs.draw, p.probs.away), 0) / sub.length / 100;
      const okN = sub.filter((p) => {
        const arg = p.probs.home >= p.probs.draw && p.probs.home >= p.probs.away ? "home" : p.probs.draw >= p.probs.away ? "draw" : "away";
        return arg === p.real;
      }).length;
      const frec = okN / sub.length;
      seg6[id][etiquetas[i]] = { n: sub.length, pMaxProm: r4(prom), frecuenciaReal: r4(frec), errorCalibracion: r4(prom - frec) };
      console.log(`    ${etiquetas[i].padEnd(7)} | ${String(sub.length).padStart(3)} | ${pct(prom, 1).padStart(11)} | ${pct(frec, 1).padStart(16)} | ${d4(prom, frec)}`);
    });
  }

  // ---- COEFICIENTES ----
  console.log("\n--- COEFICIENTES APRENDIDOS (β=Elo, γ=localía; por ventana) ---");
  for (const id of ["A", "F", "AF"]) {
    console.log(`  ${id}: ` + Object.entries(R[id].coef).map(([w, c]) => `${w}: β=${c.beta} γ=${c.gamma ?? "—"}`).join(" | "));
  }

  // ---- CRITERIO DE DECISIÓN ----
  const llAF = R.AF.res.metricas.logLoss, llA = R.A.res.metricas.logLoss, llV1 = base.logLoss;
  const brierAF = R.AF.res.metricas.brier, brierA = R.A.res.metricas.brier;
  const eceAF = R.AF.res.metricas.ece, eceA = R.A.res.metricas.ece;
  const dLLvsA = r4(llAF - llA);
  const ganaRolling = ganaVentanas("AF", "A");
  const brierOk = brierAF <= brierA, eceOk = eceAF <= eceA;
  const consistente = ganaRolling >= 3 && dLLvsA < 0;
  const candidato = consistente && brierOk && eceOk && llAF < llV1;
  const fallas = [!brierOk ? "Brier" : null, !eceOk ? "ECE" : null].filter(Boolean).join(" y ");
  const veredicto = candidato
    ? "A+F MEJORA CONSISTENTEMENTE A A → candidato experimental."
    : dLLvsA >= 0
      ? "A+F NO supera a A en LogLoss → DESCARTAR la combinación; mantener A como candidato."
      : !consistente
        ? "A+F gana en pooled pero NO es consistente (≤2/4 ventanas) → DESCARTAR; mantener A."
        : `A+F gana en LL pero empeora ${fallas} vs A → NO es mejora clara; mantener A.`;
  console.log("\n--- CRITERIO DE DECISIÓN ---");
  console.log(`ΔLL(AF−A)=${dLLvsA >= 0 ? "+" : ""}${dLLvsA.toFixed(4)} | ventanas rolling donde AF gana a A: ${ganaRolling}/4 | OFICIAL: AF ${R.AF.ventanas.OFICIAL.metricas.logLoss.toFixed(4)} vs A ${R.A.ventanas.OFICIAL.metricas.logLoss.toFixed(4)} | Brier mantiene/mejora: ${brierOk ? "sí" : "no"} (${brierAF.toFixed(4)} vs ${brierA.toFixed(4)}) | ECE mantiene/mejora: ${eceOk ? "sí" : "no"} (${eceAF.toFixed(4)} vs ${eceA.toFixed(4)}) | AF<V1: ${llAF < llV1 ? "sí" : "no"}`);
  console.log(`→ ${veredicto}`);

  // ---- INFORME ----
  const informe = {
    generado: new Date().toISOString(),
    nota: "TEST no evaluado. Mismos splits/ventanas que fase3_3; único cambio vs A: covariable de localía x_hfa=+1 (vía formaHome=0.5/formaAway=-0.5 con conForma). Sin variables nuevas. Empates solo medidos, no modificados.",
    sanidad: { v1OficialIgualJson: ok1, aIgualFaseElo10686: ok2, v1aAF_igualFase3_3: ok3, ventanasIguales: ok4, probabilidadesValidas: { ok: ok5, totalPreds, sumaMal, negativos, nan } },
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: new Date(w.eval[0].fecha).toISOString().slice(0, 10), hasta: new Date(w.eval[w.eval.length - 1].fecha).toISOString().slice(0, 10) })),
    modelos: {},
    deltas: {},
    consistencia: { ventanasGanaAF_vsA: ganaRolling, ventanasGanaAF_vsV1: ganaVentanas("AF", "V1"), oficial: { V1: r4(R.V1.ventanas.OFICIAL.metricas.logLoss), A: r4(R.A.ventanas.OFICIAL.metricas.logLoss), F: r4(R.F.ventanas.OFICIAL.metricas.logLoss), AF: r4(R.AF.ventanas.OFICIAL.metricas.logLoss) } },
    segmentos: {
      fuerza: { cortesQuintiles: q.map(r4), buckets: seg3 },
      visitanteClaramenteSuperior: { corte: r4(t2), modelos: seg4 },
      empates: seg5,
      favoritosExtremos: seg6,
    },
    coeficientes: { A: R.A.coef, F: R.F.coef, AF: R.AF.coef },
    decision: { dLLvsA, dLLvsV1: r4(llAF - llV1), ganaRolling, brierOk, eceOk, consistente, candidato, veredicto },
  };
  for (const id of orden) {
    const r = R[id].res;
    informe.modelos[id] = {
      desc: R[id].desc,
      pooled: { accuracy: r4(r.metricas.accuracy), logLoss: r4(r.metricas.logLoss), brier: r.metricas.brier, ece: r.metricas.ece, prob: r.distPred, real: r.distReal, pred: r.ext.cnt },
      porClase: r.porClase,
      porVentana: Object.fromEntries(Object.entries(R[id].ventanas).map(([k, x]) => [k, { accuracy: r4(x.metricas.accuracy), logLoss: r4(x.metricas.logLoss), brier: x.metricas.brier, ece: x.metricas.ece }])),
    };
    informe.deltas[id] = {
      dLL_vs_V1: r4(r.metricas.logLoss - base.logLoss),
      dBrier_vs_V1: r4(r.metricas.brier - base.brier),
      dECE_vs_V1: r4(r.metricas.ece - base.ece),
      dAcc_vs_V1: r4(r.metricas.accuracy - base.accuracy),
      dLL_vs_A: id === "A" ? 0 : r4(r.metricas.logLoss - llA),
    };
  }
  const ruta = guardarInforme("fase3_4_af.json", informe);
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO. Producción NO modificada.");
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
