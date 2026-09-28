// FASE 0 — Experimento V1 vs V1-LIGA (estrategias de μ).
// SOLO TRAIN+VAL. El TEST NUNCA se evalúa aquí.
// Selección por calidad probabilística (LogLoss → Brier → ECE → Accuracy).
//
// Uso: node experimentos/fase0_v1_vs_liga.js
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("./modelo_mu_exp");
const { evaluar, calcularMetricas, dividirTemporal } = require("../services/prediccion/backtest");

const VARIANTES = [
  { id: "GLOBAL", estrategia: "GLOBAL", desc: "μ global siempre" },
  { id: "SPEC10", estrategia: "SPEC10", desc: "μ de liga si n>=10" },
  { id: "V1 (SPEC30)", estrategia: "SPEC30", desc: "μ de liga si n>=30 (= modelo actual)" },
  { id: "BLEND30", estrategia: "BLEND30", desc: "μ=(n·μ_liga+30·μ_g)/(n+30)" },
  { id: "FAMILY", estrategia: "FAMILY", desc: "temporada n>=30, si no familia n>=30, si no global" },
];

const CLASES = ["home", "draw", "away"];
const r4 = (x) => Math.round(x * 10000) / 10000;
const pct = (x, d = 2) => (x * 100).toFixed(d) + "%";
const argmax = (p) => CLASES.reduce((a, b) => (p[a] >= p[b] ? a : b));

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
    por[k] = {
      recall, precision,
      f1: recall !== null && precision ? (2 * precision * recall) / (precision + recall) : null,
      realN, predN,
    };
  }
  return {
    cm, cnt, por,
    prom: { home: suma.home / n / 100, draw: suma.draw / n / 100, away: suma.away / n / 100 },
  };
}

function fila(metricas, ext) {
  return {
    acc: metricas.accuracy, ll: metricas.logLoss, brier: metricas.brier, ece: metricas.ece,
    pH: ext.prom.home, pE: ext.prom.draw, pA: ext.prom.away,
    nH: ext.cnt.home, nE: ext.cnt.draw, nA: ext.cnt.away,
  };
}

(async () => {
  console.log("=========== FASE 0 — V1 vs V1-LIGA (rolling temporal, SOLO train+val) ===========");
  const { rows } = await pool.query(`
    SELECT id, fecha_partido, liga, equipo_local, equipo_visitante, goles_local, goles_visitante
    FROM partidos WHERE estado='Ended' AND fecha_partido IS NOT NULL
      AND goles_local IS NOT NULL AND goles_visitante IS NOT NULL
    ORDER BY fecha_partido ASC, id ASC;`);
  const partidos = rows.map((x) => ({
    fecha: x.fecha_partido, liga: x.liga, home: x.equipo_local, away: x.equipo_visitante,
    goalsH: x.goles_local, goalsA: x.goles_visitante,
  }));
  const bloques = dividirTemporal(partidos, { trainPct: 0.6, valPct: 0.2 });
  const TV = [...bloques.train, ...bloques.val];
  const TEST = bloques.test; // se carga pero NUNCA se evalúa
  console.log(`TRAIN ${bloques.train.length} | VAL ${bloques.val.length} | TV ${TV.length} | TEST ${TEST.length} (NO SE TOCA)`);

  const dia = (m) => new Date(m.fecha).toISOString().slice(0, 10);
  const cortar = (arr, i) => {
    i = Math.max(1, Math.min(arr.length - 1, i));
    while (i < arr.length && dia(arr[i - 1]) === dia(arr[i])) i += 1;
    return i;
  };
  // ventanas expansivas: fit [0,ci) → eval [ci,ci+1)
  const fr = [0.5, 0.625, 0.75, 0.875, 1];
  const cortes = fr.map((f, idx) =>
    idx === fr.length - 1 ? TV.length : cortar(TV, Math.floor(TV.length * f))
  );
  const ventanas = [];
  for (let w = 0; w < 4; w++) {
    ventanas.push({ nombre: `W${w + 1}`, fit: TV.slice(0, cortes[w]), eval: TV.slice(cortes[w], cortes[w + 1]) });
  }
  console.log("ventanas rolling (fit → eval):");
  for (const v of ventanas) {
    console.log(`  ${v.nombre}: fit ${v.fit.length} (${dia(v.fit[0])}→${dia(v.fit[v.fit.length - 1])}) → eval ${v.eval.length} (${dia(v.eval[0])}→${dia(v.eval[v.eval.length - 1])})`);
  }
  const oficial = { nombre: "OFICIAL", fit: bloques.train, eval: bloques.val };

  const resultados = {}; // id → { ventanas: {nombre: {m, ext, preds}}, pooled }

  for (const v of VARIANTES) {
    resultados[v.id] = { ventanas: {} };
    // ventana oficial primero (sanidad V1)
    for (const win of [oficial, ...ventanas]) {
      const modelo = entrenarExp(win.fit, v.estrategia);
      const ev = evaluar(modelo, win.eval); // evaluar usa predecir de V1 ✓
      resultados[v.id].ventanas[win.nombre] = { metricas: ev.metricas, ext: extendidas(ev.predicciones), preds: ev.predicciones };
    }
    const pooledPreds = ventanas.flatMap((w) => resultados[v.id].ventanas[w.nombre].preds);
    const pooledM = calcularMetricas(pooledPreds);
    resultados[v.id].pooled = { metricas: pooledM, ext: extendidas(pooledPreds), preds: pooledPreds };
    console.log(`  ✓ ${v.id} entrenada en ${ventanas.length + 1} ventanas`);
  }

  // ---- SANIDAD: V1 oficial debe reproducir las métricas de FASE 1 ----
  const v1of = resultados["V1 (SPEC30)"].ventanas.OFICIAL.metricas;
  const oficialJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8")).backtest.val;
  const okSanidad = v1of.accuracy === oficialJson.accuracy && v1of.logLoss === oficialJson.logLoss && v1of.brier === oficialJson.brier;
  console.log(`\nSANIDAD V1/OFICIAL: acc=${v1of.accuracy} LL=${v1of.logLoss} Brier=${v1of.brier} ECE=${v1of.ece} → ${okSanidad ? "IDÉNTICO a FASE 1 ✓" : "DISCREPANCIA ✗ (esperado " + oficialJson.accuracy + "/" + oficialJson.logLoss + ")"}`);

  // ---- TABLA PRINCIPAL: POOLED ROLLING (decisión) ----
  console.log("\n--- TABLA 1 · POOLED ROLLING (train+val, ~760 predicciones) · orden selección: LL > Brier > ECE > Acc ---");
  console.log("Modelo              | Features μ        | Accuracy | LogLoss | Brier  | ECE    | Pred H | Pred E | Pred A | P(H)  | P(E)  | P(A)");
  const orden = [...VARIANTES].sort((a, b) => resultados[a.id].pooled.metricas.logLoss - resultados[b.id].pooled.metricas.logLoss);
  for (const v of orden) {
    const { metricas: m, ext } = resultados[v.id].pooled;
    console.log(
      `${v.id.padEnd(19)} | ${v.desc.slice(0, 18).padEnd(18)} | ${pct(m.accuracy)} | ${m.logLoss.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.ece.toFixed(4)} | ${String(ext.cnt.home).padStart(6)} | ${String(ext.cnt.draw).padStart(6)} | ${String(ext.cnt.away).padStart(6)} | ${pct(ext.prom.home, 1)} | ${pct(ext.prom.draw, 1)} | ${pct(ext.prom.away, 1)}`
    );
  }

  // ---- DELTAS vs V1 ----
  const base = resultados["V1 (SPEC30)"].pooled.metricas;
  console.log("\n--- TABLA 2 · Δ vs V1 (POOLED ROLLING) · negativo = mejora en LL/Brier/ECE ---");
  console.log("Modelo              | Δ LogLoss | Δ Brier | Δ ECE   | Δ Accuracy");
  for (const v of orden) {
    const m = resultados[v.id].pooled.metricas;
    const d = (a, b) => (a - b >= 0 ? "+" : "") + (a - b).toFixed(4);
    console.log(`${v.id.padEnd(19)} | ${d(m.logLoss, base.logLoss).padStart(9)} | ${d(m.brier, base.brier).padStart(7)} | ${d(m.ece, base.ece).padStart(7)} | ${d(m.accuracy, base.accuracy).padStart(10)}`);
  }

  // ---- POR VENTANA (estabilidad) ----
  console.log("\n--- TABLA 3 · LogLoss por ventana (estabilidad) ---");
  console.log("Modelo              | OFICIAL  | W1      | W2      | W3      | W4      | media rolling");
  for (const v of orden) {
    const cells = ventanas.map((w) => resultados[v.id].ventanas[w.nombre].metricas.logLoss.toFixed(4));
    const media = cells.reduce((a, b) => a + Number(b), 0) / cells.length;
    console.log(`${v.id.padEnd(19)} | ${resultados[v.id].ventanas.OFICIAL.metricas.logLoss.toFixed(4)} | ${cells.join(" | ")} | ${media.toFixed(4)}`);
  }
  console.log("(OFICIAL = fit TRAIN → eval VAL, comparable con FASE 1: 1.0751)");

  // ---- CONFUSIÓN + POR CLASE (POOLED) ----
  console.log("\n--- TABLA 4 · Matriz de confusión y tasas por clase (POOLED ROLLING) ---");
  for (const v of orden) {
    const { ext } = resultados[v.id].pooled;
    console.log(`\n  ${v.id} [${v.desc}]`);
    console.log(`              REAL`);
    console.log(`            H     E     A`);
    for (const pr of CLASES) {
      const f = ext.cm[pr];
      console.log(`  PRED ${pr.toUpperCase()}  ${String(f.home).padStart(4)}  ${String(f.draw).padStart(4)}  ${String(f.away).padStart(4)}`);
    }
    for (const k of CLASES) {
      const t = ext.por[k];
      console.log(`    ${k.padEnd(5)} recall=${t.recall === null ? "—" : pct(t.recall, 1).padStart(6)} precision=${t.precision === null ? "—" : pct(t.precision, 1).padStart(6)} F1=${t.f1 === null ? "—" : pct(t.f1, 1).padStart(6)} (real ${t.realN} / pred ${t.predN})`);
    }
  }

  // ---- ENFOQUE EMPATES Y VISITANTES ----
  console.log("\n--- TABLA 5 · Empates y visitantes (POOLED ROLLING) ---");
  console.log("Modelo              | P(E) prom | Empates predichos | recall E | precision E | P(A) prom | recall A | precision A");
  for (const v of orden) {
    const { metricas: m, ext } = resultados[v.id].pooled;
    const e = ext.por.draw, a = ext.por.away;
    console.log(
      `${v.id.padEnd(19)} | ${pct(ext.prom.draw, 1)}    | ${String(ext.cnt.draw).padStart(17)} | ${e.recall === null ? "—" : pct(e.recall, 1).padStart(8)} | ${e.precision === null ? "—" : pct(e.precision, 1).padStart(11)} | ${pct(ext.prom.away, 1)}    | ${pct(a.recall, 1).padStart(7)} | ${a.precision === null ? "—" : pct(a.precision, 1).padStart(10)}`
    );
  }

  // ---- GUARDAR INFORME ----
  const informe = {
    generado: new Date().toISOString(),
    nota: "TEST no evaluado. Selección solo con train+val (rolling).",
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: dia(w.eval[0]), hasta: dia(w.eval[w.eval.length - 1]) })),
    sanidadV1Oficial: { metricas: v1of, esperado: oficialJson, ok: okSanidad },
    variantes: {},
  };
  for (const v of VARIANTES) {
    const rr = resultados[v.id];
    informe.variantes[v.id] = {
      desc: v.desc,
      estrategia: v.estrategia,
      oficial: rr.ventanas.OFICIAL.metricas,
      pooled: fila(rr.pooled.metricas, rr.pooled.ext),
      pooledConfusion: rr.pooled.ext.cm,
      pooledPorClase: rr.pooled.ext.por,
      porVentana: Object.fromEntries(Object.entries(rr.ventanas).map(([k, x]) => [k, { accuracy: x.metricas.accuracy, logLoss: x.metricas.logLoss, brier: x.metricas.brier, ece: x.metricas.ece }])),
      deltaVsV1: {
        logLoss: r4(rr.pooled.metricas.logLoss - base.logLoss),
        brier: r4(rr.pooled.metricas.brier - base.brier),
        ece: r4(rr.pooled.metricas.ece - base.ece),
        accuracy: r4(rr.pooled.metricas.accuracy - base.accuracy),
      },
    };
  }
  const ruta = path.join(__dirname, "informes", "fase0_v1_vs_liga.json");
  fs.writeFileSync(ruta, JSON.stringify(informe, null, 2));
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO (reservado para la versión final elegida).");

  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
