// ---------------------------------------------------------------------------
// FASE 3.1 — DIAGNÓSTICO de V1 (sobre TRAIN + VALIDATION; TEST no se carga).
//
// Reproduce V1 (SPEC30, entrenarExp) en:
//   - TRAIN (in-sample, n=1159): sesgo optimista, para gap train→val
//   - VAL   (OFICIAL, n=364): fuera de muestra, sanidad == prediccion_poisson.json
//   - POOLED (W1..W4, n≈762): fuera de muestra rolling, potencia por segmento
//
// Segmentos: (1) diferencia de fuerza att/def, (2) superioridad local/visita,
// (3) λ total, (4) liga, (5) localía/calibración, (6) forma reciente 3/5/10
// (corte día estricto) + test de información añadida (stack log-lineal).
// ---------------------------------------------------------------------------
const pool = require("../db");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { evaluar, calcularMetricas } = require("../services/prediccion/backtest");
const {
  CLASES, r4, pct, argmax, dia, cargarTV, construirVentanas, evaluarExp,
  extendidas, llSubconjunto, calcularFormasN, resumenSegmento, guardarInforme,
} = require("./comun");

// ---- utilidades de segmentación ------------------------------------------------
function cuantiles(arrOrdenado, k) {
  // cortes en k quantiles (k-1 valores) sobre array YA ordenado
  const cortes = [];
  for (let i = 1; i < k; i++) cortes.push(arrOrdenado[Math.floor((i * arrOrdenado.length) / k)]);
  return cortes;
}
function bucketPorCortes(v, cortes, etiquetas) {
  let i = 0;
  while (i < cortes.length && v > cortes[i]) i++;
  return etiquetas[i];
}

// ---- test de información añadida (stack log-lineal sobre probs de V1) ---------
// Softmax 3 clases sobre x=[1, ln pE, ln pA, ln pH (+ Δforma estand.)];
// referencia = clase away (w_away = 0). GD + L2, ajuste sobre TRAIN, eval en VAL.
function stackSoftmax(Xtr, ytr, Xev, { epochs = 600, lr0 = 0.3, l2 = 1e-3 } = {}) {
  const K = 3; // 0 home, 1 draw, 2 away (away fijo 0)
  const D = Xtr[0].length;
  const W = Array.from({ length: K - 1 }, () => new Float64Array(D));
  let lr = lr0;
  for (let e = 0; e < epochs; e++) {
    const g = W.map(() => new Float64Array(D));
    for (let n = 0; n < Xtr.length; n++) {
      const x = Xtr[n];
      const z = [0, 0, 0];
      for (let k = 0; k < K - 1; k++) { let s = 0; for (let d = 0; d < D; d++) s += W[k][d] * x[d]; z[k] = s; }
      const mx = Math.max(...z);
      let sum = 0; const p = [0, 0, 0];
      for (let k = 0; k < K; k++) { p[k] = Math.exp(z[k] - mx); sum += p[k]; }
      for (let k = 0; k < K; k++) p[k] /= sum;
      for (let k = 0; k < K - 1; k++) {
        const err = p[k] - (ytr[n] === k ? 1 : 0);
        for (let d = 0; d < D; d++) g[k][d] += err * x[d];
      }
    }
    for (let k = 0; k < K - 1; k++) for (let d = 0; d < D; d++) {
      const reg = d === 0 ? 0 : l2 * W[k][d];
      W[k][d] -= lr * (g[k][d] / Xtr.length + reg);
    }
    lr *= 0.995;
  }
  return (Xev) => Xev.map((x) => {
    const z = [0, 0, 0];
    for (let k = 0; k < K - 1; k++) { let s = 0; for (let d = 0; d < D; d++) s += W[k][d] * x[d]; z[k] = s; }
    const mx = Math.max(...z);
    let sum = 0; const p = [0, 0, 0];
    for (let k = 0; k < K; k++) { p[k] = Math.exp(z[k] - mx); sum += p[k]; }
    return [p[0] / sum, p[1] / sum, p[2] / sum];
  });
}

const llDe = (py, y) => -Math.log(Math.max(1e-15, py[y]));

(async () => {
  console.log("=========== FASE 3.1 — DIAGNÓSTICO V1 · solo TRAIN+VAL (TEST no cargado) ===========");
  const { train, val, TV, nTrain } = await cargarTV(pool);
  console.log(`TRAIN ${train.length} | VAL ${val.length} | TV ${TV.length} (fechas oficiales del split; TEST fuera del SQL)`);

  // ---- formas 3/5/10 (día estricto) alineadas con TV ----
  const f3 = calcularFormasN(TV, 3), f5 = calcularFormasN(TV, 5), f10 = calcularFormasN(TV, 10);
  const augTV = TV.map((p, i) => ({ ...p, f3: f3[i], f5: f5[i], f10: f10[i] }));
  const { oficial, ventanas } = construirVentanas(augTV, nTrain);

  // ---- V1 OFICIAL ----
  const modOf = entrenarExp(oficial.fit, "SPEC30");
  const evTrain = evaluarExp(modOf, oficial.fit);   // in-sample
  const evVal = evaluarExp(modOf, oficial.eval);    // fuera de muestra

  // ---- SANIDADES ----
  const oficialJson = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8")).backtest.val;
  const ok1 = evVal.metricas.accuracy === oficialJson.accuracy && evVal.metricas.logLoss === oficialJson.logLoss && evVal.metricas.brier === oficialJson.brier;
  const eA = evaluar(modOf, oficial.fit.slice(0, 30)).predicciones;
  const eB = evaluarExp(modOf, oficial.fit.slice(0, 30)).predicciones;
  const ok2 = eA.every((p, i) => p.probs.home === eB[i].probs.home && p.probs.draw === eB[i].probs.draw && p.probs.away === eB[i].probs.away);
  console.log(`SANIDAD 1 · V1/OFICIAL == modelo oficial JSON: ${ok1 ? "SÍ ✓" : `NO ✗ (LL ${evVal.metricas.logLoss} vs ${oficialJson.logLoss})`}`);
  console.log(`SANIDAD 2 · evaluarExp == evaluar (producción): ${ok2 ? "SÍ ✓" : "NO ✗"}`);
  if (!ok1 || !ok2) throw new Error("Sanidades fallidas — detener.");

  // ---- items POOLED (W1..W4, fuera de muestra, con covariables de segmento) ----
  const pooledItems = [];
  const porVentana = {};
  for (const w of ventanas) {
    const modelo = entrenarExp(w.fit, "SPEC30");
    const ev = evaluarExp(modelo, w.eval);
    porVentana[w.nombre] = ev.metricas;
    w.eval.forEach((p, i) => {
      const pred = ev.predicciones[i];
      const fuerzaH = (modelo.att[p.home] ?? 0) + (modelo.def[p.home] ?? 0);
      const fuerzaA = (modelo.att[p.away] ?? 0) + (modelo.def[p.away] ?? 0);
      pooledItems.push({
        m: { ...p, deltaFuerza: fuerzaH - fuerzaA, lambdaTotal: pred.lambdaHome + pred.lambdaAway },
        pred,
      });
    });
  }
  const pooledPreds = pooledItems.map((x) => x.pred);
  const pooledMet = calcularMetricas(pooledPreds);
  console.log(`POOLED rolling: ${pooledItems.length} predicciones fuera de muestra (LL ${pooledMet.logLoss.toFixed(4)})`);

  // ==================================================================
  // 1) MÉTRICAS GLOBALES (11 ítems): acc, LL, Brier, ECE, cm, por clase,
  //    dist. probabilidades, dist pred, dist real — en train/val/pooled
  // ==================================================================
  const bloque11 = (met, preds) => ({
    n: preds.length,
    accuracy: r4(met.accuracy), logLoss: r4(met.logLoss), brier: r4(met.brier), ece: r4(met.ece),
    confusion: extendidas(preds).cm,
    porClase: Object.fromEntries(CLASES.map((c) => {
      const t = extendidas(preds).por[c];
      return [c, { recall: t.recall === null ? null : r4(t.recall), precision: t.precision === null ? null : r4(t.precision), f1: t.f1 === null ? null : r4(t.f1), realN: t.realN, predN: t.predN }];
    })),
    distReal: (() => { const c = { home: 0, draw: 0, away: 0 }; preds.forEach((p) => c[p.real]++); return { home: r4(c.home / preds.length), draw: r4(c.draw / preds.length), away: r4(c.away / preds.length) }; })(),
    distPred: (() => { const e = extendidas(preds); return { home: r4(e.prom.home), draw: r4(e.prom.draw), away: r4(e.prom.away) }; })(),
    calibration: met.calibration || null,
  });
  const globals = {
    trainInSample: bloque11(evTrain.metricas, evTrain.predicciones),
    val: bloque11(evVal.metricas, evVal.predicciones),
    pooled: bloque11(pooledMet, pooledPreds),
  };
  console.log(`\n--- GLOBALES ---`);
  console.log(`muestra      | n     | Acc     | LL     | Brier | ECE`);
  console.log(`TRAIN (in)   | ${String(globals.trainInSample.n).padStart(5)} | ${pct(globals.trainInSample.accuracy)}  | ${globals.trainInSample.logLoss.toFixed(4)} | ${globals.trainInSample.brier.toFixed(4)}  | ${globals.trainInSample.ece.toFixed(4)}`);
  console.log(`VAL (OOF)    | ${String(globals.val.n).padStart(5)} | ${pct(globals.val.accuracy)}  | ${globals.val.logLoss.toFixed(4)} | ${globals.val.brier.toFixed(4)}  | ${globals.val.ece.toFixed(4)}`);
  console.log(`POOLED (OOF) | ${String(globals.pooled.n).padStart(5)} | ${pct(globals.pooled.accuracy)}  | ${globals.pooled.logLoss.toFixed(4)} | ${globals.pooled.brier.toFixed(4)}  | ${globals.pooled.ece.toFixed(4)}`);
  console.log(`gap LL train→val = ${r4(globals.val.logLoss - globals.trainInSample.logLoss)} (sobreajuste si > 0)`);

  const tablaSegmento = (nombre, filas) => {
    console.log(`\n--- ${nombre} ---`);
    console.log(`segmento            | n   | Acc     | LL     | Brier | ECE    | real H/E/A        | pred H/E/A`);
    for (const [seg, r] of Object.entries(filas)) {
      if (!r || !r.n) continue;
      console.log(`${seg.padEnd(20)} | ${String(r.n).padStart(3)} | ${pct(r.accuracy)} | ${r.logLoss.toFixed(4)} | ${r.brier.toFixed(4)} | ${r.ece.toFixed(4)} | ${pct(r.real.home, 1)}/${pct(r.real.draw, 1)}/${pct(r.real.away, 1)} | ${pct(r.pred.home, 1)}/${pct(r.pred.draw, 1)}/${pct(r.pred.away, 1)}`);
    }
  };

  // ==================================================================
  // SEGMENTO 1 — diferencia de fuerza |Δ(att+def)| en quintiles
  // ==================================================================
  const deltas = pooledItems.map((x) => Math.abs(x.m.deltaFuerza)).sort((a, b) => a - b);
  const q = cuantiles(deltas, 5);
  const etqF = ["q1 muy pequeña", "q2 pequeña", "q3 media", "q4 grande", "q5 muy grande"];
  const seg1 = {};
  for (const e of etqF) seg1[e] = { items: [] };
  for (const it of pooledItems) {
    const b = bucketPorCortes(Math.abs(it.m.deltaFuerza), q, etqF);
    (seg1[b] = seg1[b] || { items: [] }).items.push(it);
  }
  for (const e of etqF) seg1[e] = resumenSegmento((seg1[e].items || []).map((x) => x.pred), { calcularMetricas });
  console.log(`\ncortes |Δfuerza| (quintiles): ${q.map((x) => x.toFixed(3)).join(" / ")}`);
  tablaSegmento("SEGMENTO 1 · DIFERENCIA DE FUERZA (att+def, quintiles)", seg1);

  // ==================================================================
  // SEGMENTO 2 — superioridad local/visita (5 buckets por signo y |Δ| tercil)
  // ==================================================================
  const absSorted = [...deltas];
  const t1 = absSorted[Math.floor(absSorted.length / 3)];
  const t2 = absSorted[Math.floor((2 * absSorted.length) / 3)];
  const bucketSup = (d) => {
    const a = Math.abs(d);
    if (a <= t1) return "equilibrados";
    if (d > 0) return a <= t2 ? "local ligeramente" : "local claramente";
    return a <= t2 ? "visita ligeramente" : "visita claramente";
  };
  const seg2 = {};
  for (const it of pooledItems) {
    const b = bucketSup(it.m.deltaFuerza);
    (seg2[b] = seg2[b] || { items: [] }).items.push(it);
  }
  for (const k of Object.keys(seg2)) seg2[k] = resumenSegmento(seg2[k].items.map((x) => x.pred), { calcularMetricas });
  console.log(`\ncortes superioridad: |Δ|≤${t1.toFixed(3)} = equilibrados; t2=${t2.toFixed(3)}`);
  tablaSegmento("SEGMENTO 2 · SUPERIORIDAD LOCAL/VISITA", seg2);

  // ==================================================================
  // SEGMENTO 3 — λ total (terciles)
  // ==================================================================
  const lts = pooledItems.map((x) => x.m.lambdaTotal).sort((a, b) => a - b);
  const l1 = lts[Math.floor(lts.length / 3)], l2 = lts[Math.floor((2 * lts.length) / 3)];
  const seg3 = {};
  for (const it of pooledItems) {
    const b = it.m.lambdaTotal <= l1 ? "baja (partido bajo)" : it.m.lambdaTotal <= l2 ? "media" : "alta (partido abierto)";
    (seg3[b] = seg3[b] || { items: [] }).items.push(it);
  }
  for (const k of Object.keys(seg3)) seg3[k] = resumenSegmento(seg3[k].items.map((x) => x.pred), { calcularMetricas });
  console.log(`\ncortes λ total: ≤${l1.toFixed(2)} / ≤${l2.toFixed(2)}`);
  tablaSegmento("SEGMENTO 3 · TOTAL DE GOLES ESPERADOS (λH+λA)", seg3);

  // ==================================================================
  // SEGMENTO 4 — por liga (n≥25)
  // ==================================================================
  const porLiga = new Map();
  for (const it of pooledItems) {
    if (!porLiga.has(it.m.liga)) porLiga.set(it.m.liga, []);
    porLiga.get(it.m.liga).push(it);
  }
  const seg4 = {};
  for (const [liga, arr] of porLiga) {
    if (arr.length < 25) continue;
    seg4[liga] = resumenSegmento(arr.map((x) => x.pred), { calcularMetricas });
  }
  const ligaOrden = Object.entries(seg4).sort((a, b) => b[1].logLoss - a[1].logLoss);
  console.log(`\n--- SEGMENTO 4 · POR LIGA (n≥25) — de peor a mejor LL ---`);
  console.log(`liga                                  | n   | Acc     | LL     | Brier | goles reales prom | λ prom`);
  const seg4det = {};
  for (const [liga, r] of ligaOrden) {
    const arr = porLiga.get(liga);
    const golesReales = arr.reduce((a, x) => a + x.m.goalsH + x.m.goalsA, 0) / arr.length;
    const lam = arr.reduce((a, x) => a + x.m.lambdaTotal, 0) / arr.length;
    seg4det[liga] = { ...r, golesRealesProm: r4(golesReales), lambdaProm: r4(lam) };
    console.log(`${liga.slice(0, 37).padEnd(37)} | ${String(r.n).padStart(3)} | ${pct(r.accuracy)} | ${r.logLoss.toFixed(4)} | ${r.brier.toFixed(4)} | ${golesReales.toFixed(2)}              | ${lam.toFixed(2)}`);
  }

  // ==================================================================
  // SEGMENTO 5 — LOCALÍA: calibración de P(H), goles λ vs reales, LL por resultado
  // ==================================================================
  const bins = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 100]];
  const confH = [], confE = [], confA = [];
  for (const [lo, hi] of bins) {
    const sel = (f) => pooledItems.filter((x) => { const v = f(x); return v >= lo && (v < hi || (hi === 100 && v <= 100)); });
    const fila = (arr, clave) => {
      if (!arr.length) return { rango: `${lo}-${hi}%`, n: 0 };
      const mediaPred = arr.reduce((a, x) => a + x.pred.probs[clave] / 100, 0) / arr.length;
      const freqReal = arr.reduce((a, x) => a + (x.pred.real === clave ? 1 : 0), 0) / arr.length;
      return { rango: `${lo}-${hi}%`, n: arr.length, probPredicha: r4(mediaPred), frecuenciaReal: r4(freqReal), sesgo: r4(mediaPred - freqReal) };
    };
    confH.push(fila(sel((x) => x.pred.probs.home), "home"));
    confE.push(fila(sel((x) => x.pred.probs.draw), "draw"));
    confA.push(fila(sel((x) => x.pred.probs.away), "away"));
  }
  const meanH = pooledPreds.reduce((a, p) => a + p.lambdaHome, 0) / pooledPreds.length;
  const meanA = pooledPreds.reduce((a, p) => a + p.lambdaAway, 0) / pooledPreds.length;
  let gH = 0, gA = 0;
  for (const x of pooledItems) { gH += x.m.goalsH; gA += x.m.goalsA; }
  gH /= pooledItems.length; gA /= pooledItems.length;
  const localia = {
    confianzaH: confH, confianzaE: confE, confianzaA: confA,
    lambdas: { lambdaHomeProm: r4(meanH), golesLocalesReales: r4(gH), sesgoLocal: r4(meanH - gH), lambdaAwayProm: r4(meanA), golesVisitantesReales: r4(gA), sesgoVisita: r4(meanA - gA) },
    llPorResultadoReal: { home: llSubconjunto(pooledPreds, "home"), draw: llSubconjunto(pooledPreds, "draw"), away: llSubconjunto(pooledPreds, "away") },
    recallPorClase: globals.pooled.porClase,
  };
  console.log(`\n--- SEGMENTO 5 · LOCALÍA / CALIBRACIÓN (pooled) ---`);
  console.log(`λ local prom ${meanH.toFixed(3)} vs goles reales ${gH.toFixed(3)} (sesgo ${r4(meanH - gH)}) | λ visita prom ${meanA.toFixed(3)} vs ${gA.toFixed(3)} (sesgo ${r4(meanA - gA)})`);
  console.log(`LL por resultado real: H ${localia.llPorResultadoReal.home?.toFixed(4)} | E ${localia.llPorResultadoReal.draw?.toFixed(4)} | A ${localia.llPorResultadoReal.away?.toFixed(4)}`);
  console.log(`calibración P(H) por bins (pred vs real):`);
  for (const f of confH) console.log(`  ${f.rango.padEnd(7)} n=${String(f.n).padStart(3)} pred=${f.probPredicha === undefined ? "—" : pct(f.probPredicha, 1).padStart(6)} real=${f.frecuenciaReal === undefined ? "—" : pct(f.frecuenciaReal, 1).padStart(6)} sesgo=${f.sesgo === undefined ? "—" : (f.sesgo >= 0 ? "+" : "") + pct(f.sesgo, 1)}`);

  // ==================================================================
  // SEGMENTO 6 — FORMA RECIENTE 3/5/10 (día estricto)
  // ==================================================================
  const seg6 = {};
  for (const N of [3, 5, 10]) {
    const clave = `f${N}`;
    const dforms = pooledItems.map((x) => x.m[clave].home - x.m[clave].away).sort((a, b) => a - b);
    const u1 = dforms[Math.floor(dforms.length / 3)], u2 = dforms[Math.floor((2 * dforms.length) / 3)];
    const filas = {};
    for (const it of pooledItems) {
      const d = it.m[clave].home - it.m[clave].away;
      const b = d <= u1 ? "visita en mejor forma" : d <= u2 ? "forma parecida" : "local en mejor forma";
      (filas[b] = filas[b] || { items: [] }).items.push(it);
    }
    const out = {};
    for (const k of Object.keys(filas)) out[k] = resumenSegmento(filas[k].items.map((x) => x.pred), { calcularMetricas });
    seg6[`forma${N}`] = { cortes: { u1: r4(u1), u2: r4(u2) }, segmentos: out };
    tablaSegmento(`SEGMENTO 6 · FORMA ${N} PARTIDOS PREVIOS (día estricto)`, out);
  }

  // ---- 6b) test de información añadida: ¿la forma aporta DESPUÉS de V1? ----
  // Stack sobre logits logarítmicos de V1 (ajuste TRAIN, evaluación VAL).
  const lnP = (p) => Math.log(Math.max(5e-4, p / 100));
  const filaX = (pred, forma) => {
    const base = [1, lnP(pred.probs.draw), lnP(pred.probs.away), lnP(pred.probs.home)];
    if (!forma) return base;
    return [...base, forma];
  };
  const ytr = evTrain.predicciones.map((p) => (p.real === "home" ? 0 : p.real === "draw" ? 1 : 2));
  const yev = evVal.predicciones.map((p) => (p.real === "home" ? 0 : p.real === "draw" ? 1 : 2));
  const formaTr = oficial.fit.map((p) => p.f5.home - p.f5.away);
  const formaEv = oficial.eval.map((p) => p.f5.home - p.f5.away);
  const mu = formaTr.reduce((a, b) => a + b, 0) / formaTr.length;
  const sd = Math.sqrt(formaTr.reduce((a, b) => a + (b - mu) ** 2, 0) / formaTr.length) || 1;
  const stack = {};
  const llProm = (py, y) => py.reduce((a, p, i) => a + llDe(p, y[i]), 0) / py.length;
  const baseTr = evTrain.predicciones.map((p) => filaX(p));
  const baseEv = evVal.predicciones.map((p) => filaX(p));
  stack.S0 = r4(llProm(stackSoftmax(baseTr, ytr)(baseEv), yev));
  for (const N of [3, 5, 10]) {
    const clave = `f${N}`;
    const ft = oficial.fit.map((p) => (p[clave].home - p[clave].away - mu) / sd);
    const fe = oficial.eval.map((p) => (p[clave].home - p[clave].away - mu) / sd);
    const Xtr = baseTr.map((x, i) => [...x, ft[i]]);
    const Xev = baseEv.map((x, i) => [...x, fe[i]]);
    stack[`S${N}`] = r4(llProm(stackSoftmax(Xtr, ytr)(Xev), yev));
  }
  stack.delta = {};
  for (const N of [3, 5, 10]) stack.delta[`S${N}-S0`] = r4(stack[`S${N}`] - stack.S0);
  const v1ValLL = r4(evVal.metricas.logLoss);
  console.log(`\n--- SEGMENTO 6b) STACK: ¿forma añade info tras V1? (fit TRAIN, eval VAL; V1 directo LL=${v1ValLL}) ---`);
  console.log(`  S0 (solo logs de V1): LL ${stack.S0} | S3: ${stack.S3} (Δ ${stack.delta["S3-S0"]}) | S5: ${stack.S5} (Δ ${stack.delta["S5-S0"]}) | S10: ${stack.S10} (Δ ${stack.delta["S10-S0"]})`);
  console.log(`  → Δ<0 = la forma aporta información nueva; Δ>0 = V1 ya la absorbe/ruido.`);

  // ==================================================================
  // GUARDAR INFORME
  // ==================================================================
  const informe = {
    generado: new Date().toISOString(),
    nota: "TEST no cargado (SQL filtra fecha <= fin de VAL). Bloques por fechas oficiales del split del modelo. POOLED = W1..W4 fuera de muestra. Δfuerza = (att+def)_local − (att+def)_visita del modelo de cada ventana. Forma con corte día estricto.",
    sanidad: { v1OficialIgualJson: ok1, evaluarExpIgualEvaluar: ok2 },
    muestras: { train: train.length, val: val.length, tv: TV.length, pooled: pooledItems.length },
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: dia(w.eval[0]), hasta: dia(w.eval[w.eval.length - 1]), logLoss: r4(porVentana[w.nombre].logLoss) })),
    globales: globals,
    segmentos: {
      "1_fuerza": { cortesQuintiles: q.map(r4), segmentos: seg1 },
      "2_superioridad": { cortes: { t1: r4(t1), t2: r4(t2) }, segmentos: seg2 },
      "3_lambdaTotal": { cortes: { l1: r4(l1), l2: r4(l2) }, segmentos: seg3 },
      "4_liga": seg4det,
      "5_localia": localia,
      "6_forma": { ...seg6, stackTest: { ...stack, v1DirectoLL: v1ValLL } },
    },
  };
  const ruta = guardarInforme("fase3_1_diagnostico.json", informe);
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO.");
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
