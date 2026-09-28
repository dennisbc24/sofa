// FASE 2 — V4/V5/V6: xG, remates y Elo+xG. Mismos splits que fases anteriores.
// SOLO TRAIN+VAL. TEST NUNCA se evalúa aquí. Selección: LL > Brier > ECE > Acc.
//
// Uso: node experimentos/fase_stats.js
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("./modelo_mu_exp");
const { entrenarFeatures, lambdasFeatures } = require("./modelo_stats_exp");
const { cargarPartidosConStats, construirFeatures } = require("./stats_features");
const { calcularElo } = require("./elo");
const { evaluar, calcularMetricas, dividirTemporal } = require("../services/prediccion/backtest");
const { probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");

const CLASES = ["home", "draw", "away"];
const r4 = (x) => Math.round(x * 10000) / 10000;
const pct = (x, d = 2) => (x * 100).toFixed(d) + "%";
const argmax = (p) => CLASES.reduce((a, b) => (p[a] >= p[b] ? a : b));
const realDe = (p) => (p.goalsH > p.goalsA ? "home" : p.goalsH === p.goalsA ? "draw" : "away");

function evaluarFeatures(modelo, partidos) {
  const predicciones = partidos.map((p) => {
    const { lambdaHome, lambdaAway } = lambdasFeatures(modelo, p);
    const { home, draw, away } = probsDesdeLambdas(lambdaHome, lambdaAway);
    return {
      fecha: p.fecha, home: p.home, away: p.away, liga: p.liga,
      probs: aPorcentajes(home, draw, away, 1),
      real: realDe(p),
      marcador: `${p.goalsH}-${p.goalsA}`,
    };
  });
  return { predicciones, metricas: calcularMetricas(predicciones) };
}

function extendidas(preds) {
  const n = preds.length;
  const cm = { home: { home: 0, draw: 0, away: 0 }, draw: { home: 0, draw: 0, away: 0 }, away: { home: 0, draw: 0, away: 0 } };
  const suma = { home: 0, draw: 0, away: 0 };
  const cnt = { home: 0, draw: 0, away: 0 };
  for (const p of preds) {
    cm[argmax(p.probs)][p.real]++;
    cnt[argmax(p.probs)]++;
    suma.home += p.probs.home; suma.draw += p.probs.draw; suma.away += p.probs.away;
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
  return { cm, cnt, por, prom: { home: suma.home / n / 100, draw: suma.draw / n / 100, away: suma.away / n / 100 } };
}

// LogLoss de un subconjunto de resultados reales (p.ej. solo empates)
function llSubconjunto(items, clase) {
  const sub = items.filter((x) => x.pred.real === clase);
  if (!sub.length) return null;
  const ll = sub.reduce((a, x) => a - Math.log(Math.max(1e-15, x.pred.probs[clase] / 100)), 0);
  return Math.round((ll / sub.length) * 10000) / 10000;
}

const FAM = {
  xgNorm: { nombre: "xg", forL: "xgnF_L", agL: "xgnA_L", forV: "xgnF_V", agV: "xgnA_V" },
  xgRaw: { nombre: "xg", forL: "xgrF_L", agL: "xgrA_L", forV: "xgrF_V", agV: "xgrA_V" },
  tsNorm: { nombre: "ts", forL: "tsnF_L", agL: "tsnA_L", forV: "tsnF_V", agV: "tsnA_V" },
  stNorm: { nombre: "st", forL: "stnF_L", agL: "stnA_L", forV: "stnF_V", agV: "stnA_V" },
  stRaw: { nombre: "st", forL: "strF_L", agL: "strA_L", forV: "strF_V", agV: "strA_V" },
};

const VARIANTES = [
  { id: "V1", desc: "base V1 (SPEC30)", cfg: null },
  { id: "V2", desc: "+ Elo (K=32)", cfg: { elo: true, familias: [] } },
  { id: "V4", desc: "+ xG/xGA norm liga", cfg: { elo: false, familias: [FAM.xgNorm] } },
  { id: "V4raw", desc: "+ xG/xGA crudo", cfg: { elo: false, familias: [FAM.xgRaw] } },
  { id: "V5T", desc: "+ remates totales norm", cfg: { elo: false, familias: [FAM.tsNorm] } },
  { id: "V5S", desc: "+ tiro al arco norm", cfg: { elo: false, familias: [FAM.stNorm] } },
  { id: "V5Sraw", desc: "+ tiro al arco crudo", cfg: { elo: false, familias: [FAM.stRaw] } },
  { id: "V6", desc: "V2 + xG norm", cfg: { elo: true, familias: [FAM.xgNorm] } },
];

(async () => {
  console.log("=========== FASE 2 — V4/V5/V6 · SOLO train+val ===========");
  const todos = await cargarPartidosConStats(pool);
  todos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || a.id - b.id);
  const bloques = dividirTemporal(todos, { trainPct: 0.6, valPct: 0.2 });
  const TV = [...bloques.train, ...bloques.val];
  const nTrain = bloques.train.length;
  console.log(`TRAIN ${nTrain} | VAL ${bloques.val.length} | TV ${TV.length} | TEST ${bloques.test.length} (NO SE TOCA)`);

  // features temporales (día estricto) + Elo K=32 (ya seleccionado en VAL en fase_elo)
  const { items: conFeatures } = construirFeatures(TV);
  const { antes } = calcularElo(TV, { k: 32 });
  const augTV = conFeatures.map((p, i) => ({ ...p, eloHome: antes[i].home, eloAway: antes[i].away }));
  console.log("features xG/remates temporales + Elo K=32 construidos (día estricto)");

  const dia = (m) => new Date(m.fecha).toISOString().slice(0, 10);
  const cortar = (arr, i) => {
    i = Math.max(1, Math.min(arr.length - 1, i));
    while (i < arr.length && dia(arr[i - 1]) === dia(arr[i])) i += 1;
    return i;
  };
  const fr = [0.5, 0.625, 0.75, 0.875, 1];
  const cortes = fr.map((f, idx) => (idx === fr.length - 1 ? augTV.length : cortar(augTV, Math.floor(augTV.length * f))));
  const ventanas = [];
  for (let w = 0; w < 4; w++) {
    ventanas.push({ nombre: `W${w + 1}`, fit: augTV.slice(0, cortes[w]), eval: augTV.slice(cortes[w], cortes[w + 1]) });
  }
  const oficial = { nombre: "OFICIAL", fit: augTV.slice(0, nTrain), eval: augTV.slice(nTrain) };
  console.log(`ventanas idénticas a fases previas: OFICIAL fit ${oficial.fit.length} eval ${oficial.eval.length} | W1-W4 eval ${ventanas.map((w) => w.eval.length).join("/")}`);

  const resultados = {};
  for (const V of VARIANTES) {
    resultados[V.id] = { ventanas: {}, coef: {} };
    for (const win of [oficial, ...ventanas]) {
      const modelo = V.cfg === null ? entrenarExp(win.fit, "SPEC30") : entrenarFeatures(win.fit, "SPEC30", V.cfg);
      if (modelo.cov) {
        const malos = Object.entries(modelo.cov).filter(([, v]) => !Number.isFinite(v.bf) || !Number.isFinite(v.ba) || Math.abs(v.bf) > 50 || Math.abs(v.ba) > 50);
        if (malos.length) throw new Error(`${V.id}/${win.nombre}: coeficientes no finitos en ${malos.map((x) => x[0]).join(",")}`);
      }
      const ev = V.cfg === null ? evaluar(modelo, win.eval) : evaluarFeatures(modelo, win.eval);
      const items = win.eval.map((p, i) => ({ m: p, pred: ev.predicciones[i] }));
      resultados[V.id].ventanas[win.nombre] = { metricas: ev.metricas, ext: extendidas(ev.predicciones), items };
      if (V.id !== "V1") resultados[V.id].coef[win.nombre] = { betaE: modelo.betaE ?? null, cov: modelo.cov };
    }
    const poolItems = ventanas.flatMap((w) => resultados[V.id].ventanas[w.nombre].items);
    const poolPreds = poolItems.map((x) => x.pred);
    resultados[V.id].items = poolItems;
    resultados[V.id].pooled = { metricas: calcularMetricas(poolPreds), ext: extendidas(poolPreds) };
    console.log(`  ✓ ${V.id} (${V.desc}) en ${ventanas.length + 1} ventanas`);
  }

  // ---- SANIDADES ----
  const v1of = resultados.V1.ventanas.OFICIAL.metricas;
  const oficialJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8")).backtest.val;
  const ok1 = v1of.accuracy === oficialJson.accuracy && v1of.logLoss === oficialJson.logLoss && v1of.brier === oficialJson.brier;
  const v2of = resultados.V2.ventanas.OFICIAL.metricas;
  const ok2 = Math.abs(v2of.logLoss - 1.0686) < 1e-9; // valor de fase_elo con idéntico K/splits
  console.log(`\nSANIDAD 1 · V1/OFICIAL == FASE 1: ${ok1 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 2 · V2/OFICIAL == fase_elo (LL 1.0686): ${ok2 ? `SÍ ✓ (${v2of.logLoss})` : `NO ✗ (${v2of.logLoss})`}`);

  const orden = [...VARIANTES].sort((a, b) => resultados[a.id].pooled.metricas.logLoss - resultados[b.id].pooled.metricas.logLoss);
  const base = resultados.V1.pooled.metricas;

  // ---- TABLA 1: PRINCIPAL ----
  console.log("\n--- TABLA 1 · POOLED ROLLING (762 predicciones train+val) · selección LL > Brier > ECE > Acc ---");
  console.log("Modelo   | Features               | Accuracy | LogLoss | Brier  | ECE    | Pred H | Pred E | Pred A");
  for (const V of orden) {
    const { metricas: m, ext } = resultados[V.id].pooled;
    console.log(`${V.id.padEnd(8)} | ${V.desc.slice(0, 22).padEnd(22)} | ${pct(m.accuracy)} | ${m.logLoss.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.ece.toFixed(4)} | ${String(ext.cnt.home).padStart(6)} | ${String(ext.cnt.draw).padStart(6)} | ${String(ext.cnt.away).padStart(6)}`);
  }
  console.log("\n  probabilidades medias:");
  console.log("Modelo   | P(H)    | P(E)    | P(A)");
  for (const V of orden) {
    const { ext } = resultados[V.id].pooled;
    console.log(`${V.id.padEnd(8)} | ${pct(ext.prom.home, 1)}   | ${pct(ext.prom.draw, 1)}   | ${pct(ext.prom.away, 1)}`);
  }

  // ---- TABLA 2: DELTAS ----
  console.log("\n--- TABLA 2 · Δ vs V1 (POOLED) · negativo = mejora ---");
  console.log("Modelo   | Δ LogLoss | Δ Brier | Δ ECE   | Δ Accuracy");
  for (const V of orden) {
    const m = resultados[V.id].pooled.metricas;
    const d = (a, b) => (a - b >= 0 ? "+" : "") + (a - b).toFixed(4);
    console.log(`${V.id.padEnd(8)} | ${d(m.logLoss, base.logLoss).padStart(9)} | ${d(m.brier, base.brier).padStart(7)} | ${d(m.ece, base.ece).padStart(7)} | ${d(m.accuracy, base.accuracy).padStart(10)}`);
  }

  // ---- TABLA 3: POR VENTANA + CONSISTENCIA ----
  console.log("\n--- TABLA 3 · LogLoss por ventana y consistencia (¿cuántas ventanas gana a V1?) ---");
  console.log("Modelo   | OFICIAL  | W1      | W2      | W3      | W4      | media roll | ventanas gana a V1");
  for (const V of orden) {
    const cells = ventanas.map((w) => resultados[V.id].ventanas[w.nombre].metricas.logLoss);
    const media_ = cells.reduce((a, b) => a + b, 0) / cells.length;
    const v1cells = ventanas.map((w) => resultados.V1.ventanas[w.nombre].metricas.logLoss);
    let gana = 0;
    cells.forEach((c, i) => { if (c < v1cells[i]) gana += 1; });
    const ganaOf = resultados[V.id].ventanas.OFICIAL.metricas.logLoss < resultados.V1.ventanas.OFICIAL.metricas.logLoss ? "sí" : "no";
    console.log(`${V.id.padEnd(8)} | ${resultados[V.id].ventanas.OFICIAL.metricas.logLoss.toFixed(4)} | ${cells.map((c) => c.toFixed(4)).join(" | ")} | ${media_.toFixed(4)}     | ${gana}/4 rolling + OFICIAL ${ganaOf}`);
  }

  // ---- TABLA 4: CONFUSIÓN + POR CLASE ----
  console.log("\n--- TABLA 4 · Matriz de confusión y tasas por clase (POOLED) ---");
  for (const V of orden) {
    const { ext } = resultados[V.id].pooled;
    console.log(`\n  ${V.id} (${V.desc})`);
    console.log(`            REAL`);
    console.log(`          H     E     A`);
    for (const pr of CLASES) {
      const f = ext.cm[pr];
      console.log(`  PRED ${pr.toUpperCase()}  ${String(f.home).padStart(4)}  ${String(f.draw).padStart(4)}  ${String(f.away).padStart(4)}`);
    }
    for (const k of CLASES) {
      const t = ext.por[k];
      console.log(`    ${k.padEnd(5)} recall=${t.recall === null ? "—" : pct(t.recall, 1).padStart(6)} precision=${t.precision === null ? "—" : pct(t.precision, 1).padStart(6)} F1=${t.f1 === null ? "—" : pct(t.f1, 1).padStart(6)} (real ${t.realN} / pred ${t.predN})`);
    }
  }

  // ---- TABLA 5: EMPATES Y VISITANTES ----
  console.log("\n--- TABLA 5 · Empates y visitantes específicos (POOLED) ---");
  console.log("Modelo   | P(E)    | pred E | recall E | precision E | F1 E   | LL(solo E) | P(A)    | pred A | recall A | precision A | F1 A   | LL(solo A)");
  for (const V of orden) {
    const { metricas: m, ext } = resultados[V.id].pooled;
    const items = resultados[V.id].items;
    const e = ext.por.draw, a = ext.por.away;
    const llE = llSubconjunto(items, "draw"), llA = llSubconjunto(items, "away");
    console.log(
      `${V.id.padEnd(8)} | ${pct(ext.prom.draw, 1)}   | ${String(ext.cnt.draw).padStart(6)} | ${e.recall === null ? "—" : pct(e.recall, 1).padStart(8)} | ${e.precision === null ? "—" : pct(e.precision, 1).padStart(11)} | ${e.f1 === null ? "—" : pct(e.f1, 1).padStart(6)} | ${llE === null ? "—" : llE.toFixed(4).padStart(10)} | ${pct(ext.prom.away, 1)}   | ${String(ext.cnt.away).padStart(6)} | ${pct(a.recall, 1).padStart(8)} | ${a.precision === null ? "—" : pct(a.precision, 1).padStart(11)} | ${pct(a.f1, 1).padStart(6)} | ${llA === null ? "—" : llA.toFixed(4)}`
    );
  }

  // ---- TABLA 6: POR LIGA (n>=30) — ¿la mejora es global o de 1-2 ligas? ----
  console.log("\n--- TABLA 6 · Por liga (pooled, n≥30) · ΔLL vs V1 (negativo = mejora) ---");
  const porLigaPooled = new Map();
  resultados.V1.items.forEach((x, i) => {
    const liga = x.m.liga;
    if (!porLigaPooled.has(liga)) porLigaPooled.set(liga, []);
    porLigaPooled.get(liga).push(i);
  });
  const ligaCol = orden.map((V) => V.id).filter((id) => id !== "V1");
  console.log(`Liga${" ".repeat(32)} | n   | LL_V1  | ${ligaCol.map((id) => ("Δ" + id).padEnd(8)).join("|")}`);
  const consistenciaLiga = {}; // modelo → {mejora, empeora}
  for (const id of ligaCol) consistenciaLiga[id] = { mejora: 0, empeora: 0 };
  const ligaFilas = [];
  for (const [liga, idxs] of porLigaPooled) {
    if (idxs.length < 30) continue;
    const subModelo = (id) => idxs.map((i) => resultados[id].items[i].pred);
    const llV1 = calcularMetricas(subModelo("V1")).logLoss;
    const deltas = {};
    for (const id of ligaCol) {
      const ll = calcularMetricas(subModelo(id)).logLoss;
      deltas[id] = r4(ll - llV1);
      if (deltas[id] < 0) consistenciaLiga[id].mejora += 1;
      else consistenciaLiga[id].empeora += 1;
    }
    ligaFilas.push({ liga, n: idxs.length, llV1, deltas });
  }
  ligaFilas.sort((a, b) => b.n - a.n);
  for (const f of ligaFilas) {
    console.log(`${f.liga.slice(0, 36).padEnd(36)} | ${String(f.n).padStart(3)} | ${f.llV1.toFixed(4)} | ${ligaCol.map((id) => (f.deltas[id] >= 0 ? "+" : "") + f.deltas[id].toFixed(4).padEnd(8 - (f.deltas[id] >= 0 ? 1 : 0))).join("|")}`);
  }
  console.log("  consistencia (ligas n≥30 gana/pierde vs V1):");
  for (const id of ligaCol) console.log(`    ${id.padEnd(8)} ${consistenciaLiga[id].mejora} gana / ${consistenciaLiga[id].empeora} pierde`);

  // ---- TABLA 7: BUCKETS |ΔElo| ----
  const pooledBase = resultados.V1.items;
  const diffs = pooledBase.map((x) => Math.abs(x.m.eloHome - x.m.eloAway)).sort((a, b) => a - b);
  const q1 = diffs[Math.floor(diffs.length / 3)];
  const q2 = diffs[Math.floor((2 * diffs.length) / 3)];
  const bucketDe = (m) => {
    const d = Math.abs(m.eloHome - m.eloAway);
    return d <= q1 ? "PEQUEÑA" : d <= q2 ? "MEDIA" : "GRANDE";
  };
  console.log(`\n--- TABLA 7 · Por diferencia de fuerza (terciles |ΔElo|: ≤${q1.toFixed(0)} / ≤${q2.toFixed(0)} / >${q2.toFixed(0)}) — SOLO ANÁLISIS ---`);
  console.log("Bucket    | Modelo   | n   | Accuracy | LogLoss | Brier  | P(favorito) | real fav gana");
  const bucketsInfo = {};
  for (const B of ["PEQUEÑA", "MEDIA", "GRANDE"]) {
    bucketsInfo[B] = {};
    for (const V of orden) {
      const sub = resultados[V.id].items.filter((x) => bucketDe(x.m) === B);
      const preds = sub.map((x) => x.pred);
      const mm = calcularMetricas(preds);
      let pFav = 0, favWin = 0;
      for (const it of sub) {
        const fav = it.m.eloHome >= it.m.eloAway ? "home" : "away";
        pFav += it.pred.probs[fav] / 100;
        if (it.pred.real === fav) favWin += 1;
      }
      bucketsInfo[B][V.id] = { n: sub.length, accuracy: mm.accuracy, logLoss: mm.logLoss, brier: mm.brier, pFavorito: r4(pFav / sub.length), realFavGana: r4(favWin / sub.length) };
      console.log(`${B.padEnd(9)} | ${V.id.padEnd(8)} | ${String(sub.length).padStart(3)} | ${pct(mm.accuracy)} | ${mm.logLoss.toFixed(4)} | ${mm.brier.toFixed(4)} | ${pct(pFav / sub.length, 1).padStart(11)} | ${pct(favWin / sub.length, 1)}`);
    }
  }

  // ---- COEFICIENTES ----
  console.log("\n--- COEFICIENTES APRENDIDOS (MLE sobre ventanas; bf=produce→λ, ba=recibe del rival→λ) ---");
  for (const V of orden.filter((x) => x.id !== "V1")) {
    const partes = Object.entries(resultados[V.id].coef).map(([w, c]) => {
      const fams = Object.entries(c.cov || {}).map(([k, v]) => `${k}: bf=${v.bf} ba=${v.ba}`).join(" ");
      return `${w}: ${c.betaE !== null ? "βE=" + c.betaE + " " : ""}${fams}`;
    });
    console.log(`  ${V.id}: ${partes.join(" | ")}`);
  }

  // ---- GANADOR ----
  const ganador = orden[0];
  const dLL = r4(resultados[ganador.id].pooled.metricas.logLoss - base.logLoss);
  console.log(`\n--- GANADOR POR REGLA (LL > Brier > ECE > Acc): ${ganador.id} (${ganador.desc}) — ΔLL ${dLL} vs V1 ---`);

  // ---- GUARDAR INFORME ----
  const informe = {
    generado: new Date().toISOString(),
    nota: "TEST no evaluado. K Elo=32 (seleccionado en fase_elo sobre VAL). Features temporales día-estricto; xG/remates con limpieza de NULL y ceros.",
    sanidad: { v1OficialIgualFase1: ok1, v2OficialIgualFaseElo: ok2 },
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: dia(w.eval[0]), hasta: dia(w.eval[w.eval.length - 1]) })),
    ganador: { id: ganador.id, desc: ganador.desc, deltaLL: dLL },
    cortesBuckets: { q1: r4(q1), q2: r4(q2) },
    consistenciaLiga,
    modelos: {},
    porLiga: ligaFilas,
    buckets: bucketsInfo,
  };
  for (const V of orden) {
    const rr = resultados[V.id];
    informe.modelos[V.id] = {
      desc: V.desc,
      oficial: rr.ventanas.OFICIAL.metricas,
      pooled: {
        accuracy: rr.pooled.metricas.accuracy, logLoss: rr.pooled.metricas.logLoss,
        brier: rr.pooled.metricas.brier, ece: rr.pooled.metricas.ece,
        prob: rr.pooled.ext.prom, pred: rr.pooled.ext.cnt,
      },
      confusion: rr.pooled.ext.cm,
      porClase: rr.pooled.ext.por,
      llEmpates: llSubconjunto(rr.items, "draw"),
      llVisitantes: llSubconjunto(rr.items, "away"),
      porVentana: Object.fromEntries(Object.entries(rr.ventanas).map(([k, x]) => [k, { accuracy: x.metricas.accuracy, logLoss: x.metricas.logLoss, brier: x.metricas.brier, ece: x.metricas.ece }])),
      coeficientes: rr.coef,
      deltaVsV1: {
        logLoss: r4(rr.pooled.metricas.logLoss - base.logLoss),
        brier: r4(rr.pooled.metricas.brier - base.brier),
        ece: r4(rr.pooled.metricas.ece - base.ece),
        accuracy: r4(rr.pooled.metricas.accuracy - base.accuracy),
      },
    };
  }
  const ruta = path.join(__dirname, "informes", "fase_stats.json");
  fs.writeFileSync(ruta, JSON.stringify(informe, null, 2));
  console.log(`Informe guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO (reservado para la evaluación final única).");

  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
