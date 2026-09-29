// ---------------------------------------------------------------------------
// FASE 3.5 — DIAGNÓSTICO DEL COMPONENTE DE EMPATE (solo medición).
//
// Objetivo: entender por qué el modelo predice ~63–68 empates por argmax
// cuando hay ~200 empates reales en las 762 predicciones OOF.
//
// Modelos: V1 (base) y A = V1 + Elo(K=32). A+F descartado (fase 3.4).
//
// REGLAS DE ORO (esta fase NO implementa nada):
//  - NO Davidson, Platt, temperatura, reglas/multiplicadores por liga o
//    equipo, thresholds, híbridos ni modelo separado de empate.
//  - NO tocar V1_BETA, prediccion_poisson.json ni producción.
//  - TEST no se carga (SQL fecha <= fin de VAL). Solo TRAIN+VALIDATION.
//  - Mismos splits (fechas oficiales), mismas 5 ventanas rolling día-estricto,
//    mismos hiperparámetros (SPEC30, Elo K=32), sin leakage, mismos datos
//    que las fases 3.1–3.4.
//  - λ y P(E): se usa evaluarExp también para V1 (idéntica a evaluar() de
//    producción; xElo=0) para obtener lambdaHome/lambdaAway por predicción.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { entrenarConFeatures } = require("../experimentos/modelo_elo_exp");
const { calcularElo } = require("../experimentos/elo");
const { calcularMetricas } = require("../services/prediccion/backtest");
const {
  CLASES, r4, pct, argmax, dia, cargarTV, construirVentanas, evaluarExp,
  extendidas, llSubconjunto, guardarInforme,
} = require("./comun");

// ---- utilidades -------------------------------------------------------------
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const mediana = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// copia de modelo_poisson.poissonPmf (no exportada; solo diagnóstico)
function poisPmf(k, lambda) {
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda + 1e-9) - Math.log(i);
  return Math.exp(logP);
}
// P(E) Poisson cruda SIN normalizar (rejilla idéntica a probsDesdeLambdas, K=15)
function poissonCrudo(lh, la) {
  const K = 15;
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= K; i++) for (let j = 0; j <= K; j++) {
    const p = poisPmf(i, lh) * poisPmf(j, la);
    if (i > j) home += p; else if (i === j) draw += p; else away += p;
  }
  const total = home + draw + away;
  return { home, draw, away, total };
}
// ECE binario de una clase (p.ej. empate) sobre bins de 10 puntos porcentuales.
// pares: { prob: 0..100 (puntos), obs: 0|1 }
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

// buckets de fuerza (quintiles comunes |Δ(att+def)| del modelo V1, misma
// definición que fases 3.1/3.4)
const NOMBRES_BUCKET = ["muy pequeña", "pequeña", "media", "grande", "muy grande"];

(async () => {
  console.log("=========== FASE 3.5 — DIAGNÓSTICO DEL EMPATE · solo TRAIN+VAL (TEST no cargado) ===========");
  console.log("Solo medición: Davidson/Platt/temperatura/reglas/threshold NO implementados.");
  const { TV, nTrain, valHasta } = await cargarTV(pool);
  console.log(`TV ${TV.length} (nTrain=${nTrain}) — SQL filtra fecha <= ${valHasta}`);

  const { antes } = calcularElo(TV, { k: 32 });
  const augTV = TV.map((p, i) => ({ ...p, eloHome: antes[i].home, eloAway: antes[i].away }));
  const { oficial, ventanas } = construirVentanas(augTV, nTrain);
  console.log(`ventanas idénticas: OFICIAL fit ${oficial.fit.length} eval ${oficial.eval.length} | W1-4 eval ${ventanas.map((w) => w.eval.length).join("/")}`);

  // ---- entrenar/evaluar V1 y A sobre las mismas 5 ventanas ------------------
  const MODELOS = [
    { id: "V1", train: (f) => entrenarExp(f, "SPEC30") },
    { id: "A", train: (f) => entrenarConFeatures(f, "SPEC30", { conElo: true }) },
  ];
  const R = {}; // id → { ventanas, items (pooled W1-4), pooled }
  const v1Modelos = {};
  let predsTotales = 0, sumaMal = 0, negativos = 0, nan = 0, lambdaMal = 0;
  for (const M of MODELOS) {
    R[M.id] = { ventanas: {} };
    for (const win of [oficial, ...ventanas]) {
      const modelo = M.train(win.fit);
      if (M.id === "V1") v1Modelos[win.nombre] = modelo;
      const ev = evaluarExp(modelo, win.eval); // V1: idéntica a evaluar() (xElo=0)
      predsTotales += ev.predicciones.length;
      for (const p of ev.predicciones) {
        const s = p.probs.home + p.probs.draw + p.probs.away;
        if (s !== 100) sumaMal += 1;
        if (p.probs.home < 0 || p.probs.draw < 0 || p.probs.away < 0) negativos += 1;
        if (!Number.isFinite(p.probs.home) || !Number.isFinite(p.probs.draw) || !Number.isFinite(p.probs.away)) nan += 1;
        if (!(p.lambdaHome > 0) || !(p.lambdaAway > 0) || !Number.isFinite(p.lambdaHome) || !Number.isFinite(p.lambdaAway)) lambdaMal += 1;
      }
      R[M.id].ventanas[win.nombre] = { metricas: ev.metricas, items: win.eval.map((p, i) => ({ m: p, pred: ev.predicciones[i] })) };
    }
    R[M.id].items = ventanas.flatMap((w) => R[M.id].ventanas[w.nombre].items);
    R[M.id].pooled = calcularMetricas(R[M.id].items.map((x) => x.pred));
  }

  // ---- Δfuerza común (modelo V1 de cada ventana) y datos compartidos --------
  // pooled W1-4 en orden de construcción: recorrer por ventana para asignar
  // a cada pred su Δ(att+def) del modelo V1 de SU ventana (definición común
  // de buckets en fases 3.1/3.4/3.5).
  const fuerza = new Array(R.V1.items.length);
  {
    let idx = 0;
    for (const w of ventanas) {
      const m = v1Modelos[w.nombre];
      for (const x of R.V1.items.slice(idx, idx + w.eval.length)) {
        const fH = (m.att[x.m.home] ?? 0) + (m.def[x.m.home] ?? 0);
        const fA = (m.att[x.m.away] ?? 0) + (m.def[x.m.away] ?? 0);
        fuerza[idx] = fH - fA;
        idx += 1;
      }
    }
  }
  const absF = [...fuerza].map(Math.abs).sort((a, b) => a - b);
  const q = [0.2, 0.4, 0.6, 0.8].map((fr) => absF[Math.floor(absF.length * fr)]);
  const bucketF = (f) => {
    const a = Math.abs(f);
    return a < q[0] ? NOMBRES_BUCKET[0] : a < q[1] ? NOMBRES_BUCKET[1] : a < q[2] ? NOMBRES_BUCKET[2] : a < q[3] ? NOMBRES_BUCKET[3] : NOMBRES_BUCKET[4];
  };
  const esEmpate = (pred) => pred.real === "draw";
  const nPooled = R.V1.items.length;
  const nEmpates = R.V1.items.filter((x) => esEmpate(x.pred)).length;

  // ---- SANIDADES ------------------------------------------------------------
  const oficialJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8")).backtest.val;
  const v1of = R.V1.ventanas.OFICIAL.metricas;
  const ok1 = v1of.accuracy === oficialJson.accuracy && v1of.logLoss === oficialJson.logLoss && v1of.brier === oficialJson.brier;
  const ok2 = Math.abs(R.A.ventanas.OFICIAL.metricas.logLoss - 1.0686) < 1e-9;
  const prev = JSON.parse(fs.readFileSync(path.join(__dirname, "informes", "fase3_3_experimentos.json"), "utf8"));
  const ok3 = Math.abs(R.V1.pooled.logLoss - prev.modelos.V1.pooled.logLoss) < 1e-9
    && Math.abs(R.A.pooled.logLoss - prev.modelos.A.pooled.logLoss) < 1e-9;
  const ok4 = JSON.stringify(prev.ventanas.map((v) => [v.fit, v.eval, v.desde, v.hasta]))
    === JSON.stringify(ventanas.map((w) => [w.fit.length, w.eval.length, dia(w.eval[0]), dia(w.eval[w.eval.length - 1])]));
  const ok5 = sumaMal === 0 && negativos === 0 && nan === 0 && lambdaMal === 0;
  const maxFecha = dia(ventanas[ventanas.length - 1].eval[ventanas[ventanas.length - 1].eval.length - 1]);
  const ok6 = maxFecha <= valHasta;
  console.log(`\nSANIDAD 1 · V1/OFICIAL == modelo oficial JSON: ${ok1 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 2 · A/OFICIAL == fase_elo (1.0686): ${ok2 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 3 · V1/A pooled == fase3_3: ${ok3 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 4 · ventanas idénticas a fase3_3: ${ok4 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 5 · probabilidades válidas (${predsTotales} preds): suma=100, ≥0, sin NaN; λ>0 finitas: ${ok5 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 6 · TEST no cargado (último fecha eval ${maxFecha} ≤ ${valHasta}): ${ok6 ? "SÍ ✓" : "NO ✗"}`);
  if (!ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6) throw new Error("Sanidad fallida — detener.");
  console.log(`pooled OOF: ${nPooled} preds | empates reales: ${nEmpates} (${pct(nEmpates / nPooled, 1)})`);

  // ---- SECCIÓN 1 · DIAGNÓSTICO GENERAL --------------------------------------
  const S1 = {};
  for (const id of ["V1", "A"]) {
    const preds = R[id].items.map((x) => x.pred);
    const e = extendidas(preds);
    const draws = preds.filter((p) => esEmpate(p));
    const noDraws = preds.filter((p) => !esEmpate(p));
    const pEs = preds.map((p) => p.probs.draw);
    const rankEn = (p) => {
      const orden = [...CLASES].sort((a, b) => p.probs[b] - p.probs[a]);
      return orden.indexOf("draw");
    };
    const ranks = draws.map(rankEn);
    S1[id] = {
      empatesReales: nEmpates,
      empatesArgmax: e.cnt.draw,
      recall: r4(e.por.draw.recall), precision: r4(e.por.draw.precision), f1: r4(e.por.draw.f1),
      llEmpates: llSubconjunto(preds, "draw"),
      brierE: brierBinario(preds.map((p) => ({ prob: p.probs.draw, obs: p.real === "draw" ? 1 : 0 }))),
      pEmedia: r4(media(pEs)), pEmediana: r4(mediana(pEs)),
      pEnEmpates: r4(media(draws.map((p) => p.probs.draw))),
      pEnNoEmpates: r4(media(noDraws.map((p) => p.probs.draw))),
      sumaEsperada: r4((media(pEs) / 100) * nPooled),
      enEmpates: {
        pH: r4(media(draws.map((p) => p.probs.home))),
        pE: r4(media(draws.map((p) => p.probs.draw))),
        pA: r4(media(draws.map((p) => p.probs.away))),
        eArgmax: ranks.filter((r) => r === 0).length,
        eSegunda: ranks.filter((r) => r === 1).length,
        eTercera: ranks.filter((r) => r === 2).length,
      },
    };
  }
  console.log("\n--- SECCIÓN 1 · DIAGNÓSTICO GENERAL DEL EMPATE (pooled 762) ---");
  console.log(`empates reales: ${nEmpates} (${pct(nEmpates / nPooled, 1)}) — iguales para ambos modelos`);
  console.log("métrica                          | V1        | A");
  const fila = (et, a, b) => console.log(`${et.padEnd(32)} | ${String(a).padStart(9)} | ${String(b).padStart(9)}`);
  fila("empates argmax (predichos)", S1.V1.empatesArgmax, S1.A.empatesArgmax);
  fila("recall E", S1.V1.recall, S1.A.recall);
  fila("precision E", S1.V1.precision, S1.A.precision);
  fila("F1 E", S1.V1.f1, S1.A.f1);
  fila("LL clase empate", S1.V1.llEmpates, S1.A.llEmpates);
  fila("Brier E (binario)", S1.V1.brierE, S1.A.brierE);
  fila("P(E) media", S1.V1.pEmedia + "%", S1.A.pEmedia + "%");
  fila("P(E) mediana", S1.V1.pEmediana + "%", S1.A.pEmediana + "%");
  fila("P(E) en empates reales", S1.V1.pEnEmpates + "%", S1.A.pEnEmpates + "%");
  fila("P(E) en NO empates", S1.V1.pEnNoEmpates + "%", S1.A.pEnNoEmpates + "%");
  fila("empates esperados (ΣP(E))", S1.V1.sumaEsperada, S1.A.sumaEsperada);
  for (const id of ["V1", "A"]) {
    const x = S1[id].enEmpates;
    console.log(`  ${id} · en empates reales: P(H)=${x.pH}% P(E)=${x.pE}% P(A)=${x.pA}% | E argmax ${x.eArgmax} | E 2ª ${x.eSegunda} | E 3ª ${x.eTercera}`);
  }
  console.log(`→ CASO A (poca P(E) global): P(E) media V1 ${S1.V1.pEmedia}% vs frec real ${pct(nEmpates / nPooled, 1)} → esperados ${S1.V1.sumaEsperada} vs reales ${nEmpates}`);
  console.log(`→ CASO B (P(E) razonable pero nunca gana argmax): en empates reales P(E)=${S1.V1.pEnEmpates}% vs P(H)=${S1.V1.enEmpates.pH}% / P(A)=${S1.V1.enEmpates.pA}%; E fue argmax solo ${S1.V1.enEmpates.eArgmax}/${nEmpates}`);

  // ---- SECCIÓN 2 · DISTRIBUCIÓN DE P(E) -------------------------------------
  const EDGE = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 30], [30, 40], [40, 101]];
  const etiquetaB = (i) => (i === 7 ? ">40%" : `${EDGE[i][0]}-${EDGE[i][1]}%`);
  const S2 = {};
  for (const id of ["V1", "A"]) {
    S2[id] = EDGE.map(([d, h], i) => {
      const sub = R[id].items.filter((x) => x.pred.probs.draw >= d && x.pred.probs.draw < h);
      const emp = sub.filter((x) => esEmpate(x.pred)).length;
      const prom = media(sub.map((x) => x.pred.probs.draw));
      return {
        bucket: etiquetaB(i), n: sub.length, empatesReales: emp,
        frecReal: sub.length ? r4(emp / sub.length) : null,
        pEprom: prom === null ? null : r4(prom),
        diferencia: prom === null ? null : r4(prom - (emp / sub.length) * 100),
        argmaxE: sub.filter((x) => argmax(x.pred.probs) === "draw").length,
      };
    });
  }
  console.log("\n--- SECCIÓN 2 · DISTRIBUCIÓN DE P(E) (buckets) ---");
  for (const id of ["V1", "A"]) {
    console.log(`\n${id}:`);
    console.log("| P(E)  | Partidos | Empates reales | Frecuencia real | P(E) prom | Diferencia | Argmax E |");
    S2[id].forEach((b) => {
      const f = b.frecReal === null ? "  —  " : pct(b.frecReal, 1);
      const p = b.pEprom === null ? "  —  " : pct(b.pEprom / 100, 1);
      const d = b.diferencia === null ? "  —  " : (b.diferencia >= 0 ? "+" : "") + b.diferencia.toFixed(1) + " pts";
      console.log(`| ${b.bucket.padEnd(6)} | ${String(b.n).padStart(8)} | ${String(b.empatesReales).padStart(14)} | ${f.padStart(15)} | ${p.padStart(9)} | ${d.padStart(10)} | ${String(b.argmaxE).padStart(8)} |`);
    });
  }

  // ---- SECCIÓN 3 · EMPATES REALES POR DIFERENCIA DE FUERZA ------------------
  const S3 = { buckets: { V1: [], A: [] }, detalle: [] };
  for (const id of ["V1", "A"]) {
    for (const nb of NOMBRES_BUCKET) {
      const sub = R[id].items.filter((x, i) => esEmpate(x.pred) && bucketF(fuerza[i]) === nb);
      if (!sub.length) { S3.buckets[id].push({ bucket: nb, n: 0 }); continue; }
      const dfs = R[id].items.filter((x, i) => esEmpate(x.pred) && bucketF(fuerza[i]) === nb).map((x) => fuerza[R[id].items.indexOf(x)]);
      S3.buckets[id].push({
        bucket: nb, n: sub.length,
        pH: r4(media(sub.map((x) => x.pred.probs.home))),
        pE: r4(media(sub.map((x) => x.pred.probs.draw))),
        pA: r4(media(sub.map((x) => x.pred.probs.away))),
        deltaFuerza: r4(media(dfs)),
        lambdaHome: r4(media(sub.map((x) => x.pred.lambdaHome))),
        lambdaAway: r4(media(sub.map((x) => x.pred.lambdaAway))),
      });
    }
  }
  {
    let idx = 0;
    for (const w of ventanas) {
      R.V1.items.slice(idx, idx + w.eval.length).forEach((x, j) => {
        const i = idx + j;
        if (esEmpate(x.pred)) {
          const pa = R.A.items[i].pred;
          S3.detalle.push({
            fecha: dia(x.m), liga: x.m.liga, home: x.m.home, away: x.m.away,
            bucket: bucketF(fuerza[i]), deltaFuerza: r4(fuerza[i]),
            V1: { pH: x.pred.probs.home, pE: x.pred.probs.draw, pA: x.pred.probs.away, lh: r4(x.pred.lambdaHome), la: r4(x.pred.lambdaAway) },
            A: { pH: pa.probs.home, pE: pa.probs.draw, pA: pa.probs.away, lh: r4(pa.lambdaHome), la: r4(pa.lambdaAway) },
            marcador: x.pred.marcador,
          });
        }
      });
      idx += w.eval.length;
    }
  }
  console.log("\n--- SECCIÓN 3 · EMPATES REALES (n=200) POR |ΔFUERZA| (quintiles V1) ---");
  for (const id of ["V1", "A"]) {
    console.log(`\n${id}:`);
    console.log("| bucket      | n   | P(H)   | P(E)   | P(A)   | Δfuerza | λL    | λV    |");
    for (const b of S3.buckets[id]) {
      if (!b.n) { console.log(`| ${b.bucket.padEnd(11)} |   0 | —      | —      | —      | —       | —     | —     |`); continue; }
      console.log(`| ${b.bucket.padEnd(11)} | ${String(b.n).padStart(3)} | ${pct(b.pH / 100, 1)} | ${pct(b.pE / 100, 1)} | ${pct(b.pA / 100, 1)} | ${String(b.deltaFuerza).padStart(7)} | ${b.lambdaHome.toFixed(3)} | ${b.lambdaAway.toFixed(3)} |`);
    }
  }
  const empBucket = NOMBRES_BUCKET.map((nb) => `${nb}: ${S3.detalle.filter((d) => d.bucket === nb).length}`).join(" | ");
  console.log(`  distribución de los ${nEmpates} empates reales → ${empBucket}`);
  console.log(`  (detalle por partido en el informe JSON: ${S3.detalle.length} filas)`);

  // ---- SECCIÓN 4 · λ LOCAL VS λ VISITANTE ----------------------------------
  const S4 = { grupos: { V1: {}, A: {} }, bucketsDeltaL: [] };
  for (const id of ["V1", "A"]) {
    const preds = R[id].items.map((x) => x.pred);
    const con = (arr) => ({
      n: arr.length,
      lHome: r4(media(arr.map((p) => p.lambdaHome))),
      lAway: r4(media(arr.map((p) => p.lambdaAway))),
      lTotal: r4(media(arr.map((p) => p.lambdaHome + p.lambdaAway))),
      absDelta: r4(media(arr.map((p) => Math.abs(p.lambdaHome - p.lambdaAway)))),
      absDeltaMediana: r4(mediana(arr.map((p) => Math.abs(p.lambdaHome - p.lambdaAway)))),
      ratioMediana: r4(mediana(arr.map((p) => Math.min(p.lambdaHome, p.lambdaAway) / Math.max(p.lambdaHome, p.lambdaAway)))),
    });
    S4.grupos[id].empate = con(preds.filter((p) => p.real === "draw"));
    S4.grupos[id].noEmpate = con(preds.filter((p) => p.real !== "draw"));
  }
  const EDGEL = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 1.0], [1.0, 99]];
  for (const [d, h] of EDGEL) {
    const idxs = R.V1.items.map((x, i) => i).filter((i) => {
      const dl = Math.abs(R.V1.items[i].pred.lambdaHome - R.V1.items[i].pred.lambdaAway);
      return dl >= d && dl < h;
    });
    const emp = idxs.filter((i) => esEmpate(R.V1.items[i].pred)).length;
    S4.bucketsDeltaL.push({
      bucket: `${d.toFixed(1)}-${h >= 99 ? "∞" : h.toFixed(1)}`,
      n: idxs.length,
      empatesReales: emp,
      frecReal: r4(emp / idxs.length),
      pEV1: r4(media(idxs.map((i) => R.V1.items[i].pred.probs.draw))),
      pEA: r4(media(idxs.map((i) => R.A.items[i].pred.probs.draw))),
    });
  }
  console.log("\n--- SECCIÓN 4 · λ LOCAL VS λ VISITANTE ---");
  for (const id of ["V1", "A"]) {
    const g = S4.grupos[id];
    console.log(`  ${id}: empates     n=${g.empate.n} | λL=${g.empate.lHome} λV=${g.empate.lAway} λtot=${g.empate.lTotal} | |λL−λV| prom=${g.empate.absDelta} med=${g.empate.absDeltaMediana} | ratio min/max med=${g.empate.ratioMediana}`);
    console.log(`  ${id}: no empates  n=${g.noEmpate.n} | λL=${g.noEmpate.lHome} λV=${g.noEmpate.lAway} λtot=${g.noEmpate.lTotal} | |λL−λV| prom=${g.noEmpate.absDelta} med=${g.noEmpate.absDeltaMediana} | ratio min/max med=${g.noEmpate.ratioMediana}`);
  }
  console.log("\n| |λL−λV| (V1) | n   | Empates reales | Frec real | P(E) prom V1 | P(E) prom A |");
  for (const b of S4.bucketsDeltaL) {
    console.log(`| ${b.bucket.padEnd(13)} | ${String(b.n).padStart(3)} | ${String(b.empatesReales).padStart(14)} | ${pct(b.frecReal, 1).padStart(11)} | ${pct(b.pEV1 / 100, 1).padStart(13)} | ${pct(b.pEA / 100, 1).padStart(12)} |`);
  }

  // ---- SECCIÓN 5 · P(E) ACTUAL vs P(E) POISSON vs REAL ----------------------
  const S5 = {};
  for (const id of ["V1", "A"]) {
    let difConvMax = 0, difConvProm = 0, difNormProm = 0, colaProm = 0, difNormMax = 0;
    const pares = [];
    for (const x of R[id].items) {
      const p = x.pred;
      const crudo = poissonCrudo(p.lambdaHome, p.lambdaAway);
      const poissonPct = (crudo.draw / crudo.total) * 100;
      const difConv = Math.abs(p.probs.draw - poissonPct);
      const difNorm = Math.abs(poissonPct - crudo.draw * 100);
      difConvMax = Math.max(difConvMax, difConv);
      difConvProm += difConv;
      difNormProm += difNorm;
      difNormMax = Math.max(difNormMax, difNorm);
      colaProm += 1 - crudo.total;
      pares.push({ prob: p.probs.draw, obs: p.real === "draw" ? 1 : 0 });
    }
    const nI = R[id].items.length;
    const calib = eceBinario(pares, 10);
    S5[id] = {
      difConvProm: r4(difConvProm / nI), difConvMax: r4(difConvMax),
      difNormProm: r4(difNormProm / nI), difNormMax: r4(difNormMax),
      colaPoisson: r4(colaProm / nI),
      poissonECE: calib.ece,
      pEpoissonMedia: r4(media(R[id].items.map((x) => {
        const c = poissonCrudo(x.pred.lambdaHome, x.pred.lambdaAway);
        return (c.draw / c.total) * 100;
      }))),
      sumaEsperadaPoisson: r4(media(R[id].items.map((x) => {
        const c = poissonCrudo(x.pred.lambdaHome, x.pred.lambdaAway);
        return (c.draw / c.total) * 100;
      })) / 100 * nPooled),
    };
  }
  console.log("\n--- SECCIÓN 5 · P(E) MODELO vs P(E) POISSON vs REAL ---");
  console.log("| modelo | P(E) modelo−Poisson (prom/max pts) | Poisson−crudo (prom/max pts) | cola >15 | ΣP(E) Poisson | reales |");
  for (const id of ["V1", "A"]) {
    const s = S5[id];
    console.log(`| ${id.padEnd(6)} | ${String(s.difConvProm).padStart(8)} / ${String(s.difConvMax).padStart(4)}           | ${String(s.difNormProm).padStart(6)} / ${String(s.difNormMax).padStart(4)}              | ${s.colaPoisson}   | ${String(s.sumaEsperadaPoisson).padStart(13)} | ${String(nEmpates).padStart(6)} |`);
  }
  console.log(`→ B (conversión λ→1X2): pérdida máxima ${Math.max(S5.V1.difConvMax, S5.A.difConvMax)} pts (redondeo a 1 decimal) → NULA`);
  console.log(`→ C (normalización/post): pérdida máxima ${Math.max(S5.V1.difNormMax, S5.A.difNormMax)} pts (cola K=15) → NEGLIGIBLE`);
  console.log(`→ A (λ→P(E) de Poisson): V1 espera ${S5.V1.sumaEsperadaPoisson} empates vs ${nEmpates} reales (ECE binario empate: V1 ${S5.V1.poissonECE} / A ${S5.A.poissonECE})`);

  // ---- SECCIÓN 6 · MARCADORES DE EMPATE -------------------------------------
  const drawReal = S3.detalle.map((d) => d.marcador);
  const tipoM = (m) => (["0-0", "1-1", "2-2", "3-3"].includes(m) ? m : "otros");
  const obs = { "0-0": 0, "1-1": 0, "2-2": 0, "3-3": 0, otros: 0 };
  for (const m of drawReal) obs[tipoM(m)] += 1;
  const esp = {};
  for (const id of ["V1", "A"]) {
    const e = { "0-0": 0, "1-1": 0, "2-2": 0, "3-3": 0, otros: 0 };
    for (const x of R[id].items) {
      const p = x.pred;
      for (let k = 0; k <= 6; k++) {
        const pr = poisPmf(k, p.lambdaHome) * poisPmf(k, p.lambdaAway);
        const key = k <= 3 ? `${k}-${k}` : "otros";
        e[key] += pr;
      }
    }
    esp[id] = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, r4(v)]));
  }
  const S6 = { observado: obs, esperado: esp };
  console.log("\n--- SECCIÓN 6 · MARCADORES DE EMPATE (reales vs esperados Poisson) ---");
  console.log("| marcador | observado | esperado V1 | esperado A |");
  for (const k of ["0-0", "1-1", "2-2", "3-3", "otros"]) {
    console.log(`| ${k.padEnd(8)} | ${String(obs[k]).padStart(9)} | ${String(esp.V1[k]).padStart(11)} | ${String(esp.A[k]).padStart(10)} |`);
  }
  console.log(`→ concentración real: 0-0 + 1-1 = ${obs["0-0"] + obs["1-1"]} de ${nEmpates} (${pct((obs["0-0"] + obs["1-1"]) / nEmpates, 1)}); ≥2-2 = ${obs["2-2"] + obs["3-3"] + obs.otros}`);

  // ---- SECCIÓN 7 · PARTIDOS EQUILIBRADOS ------------------------------------
  const S7 = { V1: [], A: [] };
  for (const id of ["V1", "A"]) {
    for (const nb of NOMBRES_BUCKET) {
      const idxs = R.V1.items.map((x, i) => i).filter((i) => bucketF(fuerza[i]) === nb);
      const sub = idxs.map((i) => R[id].items[i].pred);
      const emp = sub.filter((p) => p.real === "draw").length;
      const calib = eceBinario(sub.map((p) => ({ prob: p.probs.draw, obs: p.real === "draw" ? 1 : 0 })), 10);
      S7[id].push({
        bucket: nb, n: idxs.length, empates: emp,
        frecReal: r4(emp / idxs.length),
        pEprom: r4(media(sub.map((p) => p.probs.draw))),
        argmaxE: sub.filter((p) => argmax(p.probs) === "draw").length,
        llEmpates: llSubconjunto(sub, "draw"),
        ecePE: calib.ece,
      });
    }
  }
  console.log("\n--- SECCIÓN 7 · PARTIDOS EQUILIBRADOS (|Δfuerza|) · V1 vs A ---");
  console.log("| bucket      | n   | Empates | Frec real | P(E) prom | Argmax E | LL empate | ECE P(E) |");
  for (let i = 0; i < NOMBRES_BUCKET.length; i++) {
    const v = S7.V1[i], a = S7.A[i];
    console.log(`| ${v.bucket.padEnd(11)} | ${String(v.n).padStart(3)} | ${String(v.empates).padStart(7)} | ${pct(v.frecReal, 1).padStart(9)} | V1 ${pct(v.pEprom / 100, 1).padStart(6)} / A ${pct(a.pEprom / 100, 1).padStart(6)} | V1 ${String(v.argmaxE).padStart(3)}/A ${String(a.argmaxE).padStart(3)} | V1 ${String(v.llEmpates).padStart(6)}/A ${String(a.llEmpates).padStart(6)} | V1 ${String(v.ecePE).padStart(5)}/A ${String(a.ecePE).padStart(5)} |`);
  }
  const eqV1 = S7.V1[0], eqA = S7.A[0];
  console.log(`→ sobreconfianza Elo en "muy pequeña": P(E) V1 ${pct(eqV1.pEprom / 100, 1)} → A ${pct(eqA.pEprom / 100, 1)} (frec real ${pct(eqV1.frecReal, 1)}); ECE P(E): V1 ${eqV1.ecePE} → A ${eqA.ecePE}`);

  // ---- SECCIÓN 8 · CALIBRACIÓN ESPECÍFICA DEL EMPATE -----------------------
  const S8 = {};
  for (const id of ["V1", "A"]) {
    const pares = R[id].items.map((x) => ({ prob: x.pred.probs.draw, obs: esEmpate(x.pred) ? 1 : 0 }));
    const calib = eceBinario(pares, 10);
    S8[id] = { filas: calib.filas.map((f) => ({ ...f, probProm: r4(f.probProm), frecReal: r4(f.frecReal), error: r4((f.frecReal - f.probProm / 100) * 100) })), ece: calib.ece, brier: brierBinario(pares) };
  }
  console.log("\n--- SECCIÓN 8 · CALIBRACIÓN ESPECÍFICA DEL EMPATE (bins de 10 pts) ---");
  for (const id of ["V1", "A"]) {
    console.log(`\n${id}: | Bucket P(E) | N | Empates reales | Frecuencia real | P(E) prom | Error |`);
    for (const f of S8[id].filas) {
      console.log(`  | ${f.rango.padEnd(12)} | ${String(f.n).padStart(3)} | ${String(Math.round(f.frecReal * f.n)).padStart(14)} | ${pct(f.frecReal, 1).padStart(15)} | ${pct(f.probProm / 100, 1).padStart(9)} | ${(f.error >= 0 ? "+" : "") + pct(f.error / 100, 1).padStart(7)} |`);
    }
    console.log(`  ECE empate: ${S8[id].ece} | Brier empate: ${S8[id].brier}`);
  }

  // ---- SECCIÓN 9 · DIFERENCIA ENTRE V1 Y A ---------------------------------
  console.log("\n--- SECCIÓN 9 · V1 vs A (¿el Elo mejora el empate o solo la distribución?) ---");
  const s9 = (et, a, b) => console.log(`${et.padEnd(34)} | ${String(a).padStart(9)} | ${String(b).padStart(9)}`);
  s9("métrica", "V1", "A");
  s9("P(E) promedio", S1.V1.pEmedia + "%", S1.A.pEmedia + "%");
  s9("P(E) en empates reales", S1.V1.pEnEmpates + "%", S1.A.pEnEmpates + "%");
  s9("P(E) en no empates", S1.V1.pEnNoEmpates + "%", S1.A.pEnNoEmpates + "%");
  s9("separación (emp − no)", (S1.V1.pEnEmpates - S1.V1.pEnNoEmpates).toFixed(1) + " pts", (S1.A.pEnEmpates - S1.A.pEnNoEmpates).toFixed(1) + " pts");
  s9("recall E", S1.V1.recall, S1.A.recall);
  s9("LL empate", S1.V1.llEmpates, S1.A.llEmpates);
  s9("Brier E (binario)", S1.V1.brierE, S1.A.brierE);
  s9("ECE P(E) (bins 10)", S8.V1.ece, S8.A.ece);
  const S9 = {
    v1: S1.V1, a: S1.A,
    separacion: { v1: r4(S1.V1.pEnEmpates - S1.V1.pEnNoEmpates), a: r4(S1.A.pEnEmpates - S1.A.pEnNoEmpates) },
    ecePE: { v1: S8.V1.ece, a: S8.A.ece },
  };

  // ---- SECCIÓN 10 · ARGMAX VS PROBABILIDAD (empates reales) ----------------
  const EDGESG = [[0, 5], [5, 10], [10, 20], [20, 30], [30, 101]];
  const S10 = {};
  for (const id of ["V1", "A"]) {
    const draws = R[id].items.filter((x) => esEmpate(x.pred)).map((x) => x.pred);
    const filas = EDGESG.map(([d, h], i) => {
      const sub = draws.filter((p) => {
        const gap = Math.max(p.probs.home, p.probs.draw, p.probs.away) - p.probs.draw;
        return gap >= d && gap < h;
      });
      return {
        bucket: i === 4 ? ">30 pts" : `${d}-${h} pts`,
        n: sub.length,
        pct: r4(sub.length / draws.length),
        eSegunda: sub.filter((p) => {
          const orden = [...CLASES].sort((a, b) => p.probs[b] - p.probs[a]);
          return orden.indexOf("draw") === 1;
        }).length,
        gapProm: sub.length ? r4(media(sub.map((p) => Math.max(p.probs.home, p.probs.draw, p.probs.away) - p.probs.draw))) : null,
      };
    });
    const gaps = draws.map((p) => Math.max(p.probs.home, p.probs.draw, p.probs.away) - p.probs.draw);
    S10[id] = {
      filas,
      gapMediano: r4(mediana(gaps)),
      ePrimeras2: draws.filter((p) => {
        const orden = [...CLASES].sort((a, b) => p.probs[b] - p.probs[a]);
        return orden.indexOf("draw") <= 1;
      }).length,
      cerca10: r4(draws.filter((p) => Math.max(p.probs.home, p.probs.draw, p.probs.away) - p.probs.draw < 10).length / draws.length),
    };
  }
  console.log("\n--- SECCIÓN 10 · ARGMAX vs PROBABILIDAD (en los empates reales) ---");
  for (const id of ["V1", "A"]) {
    console.log(`\n${id}: | gap P(max)−P(E) | n   | % empates | E era 2ª | gap prom |`);
    for (const f of S10[id].filas) {
      console.log(`  | ${f.bucket.padEnd(15)} | ${String(f.n).padStart(3)} | ${pct(f.pct, 1).padStart(9)} | ${String(f.eSegunda).padStart(8)} | ${f.gapProm === null ? "    —" : String(f.gapProm).padStart(6)} |`);
    }
    console.log(`  gap mediano=${S10[id].gapMediano} pts | E entre las 2 mayores: ${S10[id].ePrimeras2}/${nEmpates} | gap<10 pts: ${pct(S10[id].cerca10, 1)}`);
  }

  // ---- SECCIÓN 12 · CASOS (indicadores computados) -------------------------
  const casos = {
    A_lambda: {
      desc: "Poisson genera λ poco adecuadas para equilibrados",
      evidencia: {
        ecePorBucket: Object.fromEntries(NOMBRES_BUCKET.map((nb, i) => [nb, { v1: S7.V1[i].ecePE, a: S7.A[i].ecePE }])),
        frecVsPEquilib: { bucket0: { frecReal: S7.V1[0].frecReal, pEV1: S7.V1[0].pEprom, pEA: S7.A[0].pEprom } },
        gapDeltaL: S4.bucketsDeltaL,
      },
    },
    B_conversion: {
      desc: "λ razonables pero conversión λ→1X2 subestima el empate",
      evidencia: { difConvPromPts: S5.V1.difConvProm, difConvMaxPts: S5.V1.difConvMax },
    },
    C_argmax: {
      desc: "P(E) razonablemente calibrada pero argmax favorece H/A",
      evidencia: {
        sumaEsperadaVsReal: { V1: S1.V1.sumaEsperada, A: S1.A.sumaEsperada, reales: nEmpates },
        eArgmaxEnEmpates: { V1: S1.V1.enEmpates.eArgmax, A: S1.A.enEmpates.eArgmax },
        gapMediano: { V1: S10.V1.gapMediano, A: S10.A.gapMediano },
        cerca10: { V1: S10.V1.cerca10, A: S10.A.cerca10 },
        separacion: S9.separacion,
      },
    },
    D_dificil: {
      desc: "Empates intrínsecamente difíciles sin señal fuerte",
      evidencia: {
        separacion: S9.separacion,
        recallE: { V1: S1.V1.recall, A: S1.A.recall },
        llEmpates: { V1: S1.V1.llEmpates, A: S1.A.llEmpates },
      },
    },
  };
  console.log("\n--- SECCIÓN 12 · INDICADORES PARA LOS CASOS A/B/C/D (interpretación en el informe) ---");
  console.log(`A: ECE P(E) por bucket de fuerza (V1): ${NOMBRES_BUCKET.map((nb, i) => `${nb}=${S7.V1[i].ecePE}`).join(" ")}`);
  console.log(`B: pérdida conversión ≈ ${S5.V1.difConvProm} pts (prom), ${S5.V1.difConvMax} (max)`);
  console.log(`C: ΣP(E) V1=${S1.V1.sumaEsperada} A=${S1.A.sumaEsperada} vs reales=${nEmpates} | gap mediano en empates: V1=${S10.V1.gapMediano} A=${S10.A.gapMediano} pts | E en top-2: V1=${S10.V1.ePrimeras2} A=${S10.A.ePrimeras2}`);
  console.log(`D: separación P(E)|emp − P(E)|no: V1=${S9.separacion.v1} A=${S9.separacion.a} pts | recall E: V1=${S1.V1.recall} A=${S1.A.recall}`);

  // ---- INFORME --------------------------------------------------------------
  const informe = {
    generado: new Date().toISOString(),
    nota: "FASE 3.5 — solo diagnóstico del empate. Nada de Davidson/Platt/temperatura/reglas/threshold. TEST no cargado. Solo V1 y A (A+F descartado en 3.4).",
    sanidad: { v1OficialIgualJson: ok1, aIgualFaseElo: ok2, pooledIgualFase3_3: ok3, ventanasIguales: ok4, probsValidas: ok5, testNoCargado: ok6 },
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: dia(w.eval[0]), hasta: dia(w.eval[w.eval.length - 1]) })),
    cortesFuerza: q.map(r4),
    secciones: {
      s1_general: S1,
      s2_distribucionPE: S2,
      s3_empatesReales: S3,
      s4_lambdas: S4,
      s5_poisson: S5,
      s6_marcadores: S6,
      s7_equilibrados: S7,
      s8_calibracionEmpate: S8,
      s9_v1_vs_a: S9,
      s10_argmax: S10,
      casos,
    },
  };
  const ruta = guardarInforme("fase3_5_empates.json", informe);
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO. Producción NO modificada. (Validaciones externas de hashes/endpoints pendientes de ejecutar aparte.)");
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
