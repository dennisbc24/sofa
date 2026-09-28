// FASE 2 — CALIBRACIÓN de V1 y V2 (Platt multicategoría H/E/A).
//
//   A) V1 sin calibrar   B) V1 + Platt   C) V2 sin calibrar   D) V2 + Platt
//
// Mismos splits temporales estrictos que fases anteriores (OFICIAL fit TRAIN
// 1159 → eval VAL 364; 4 ventanas rolling sobre TV=1523 con corte por día
// entero; último corte fijo a TV.length). SOLO TRAIN+VAL. TEST NUNCA se toca.
//
// Anti-leakage de la calibración: por cada modelo×ventana, el Platt se ajusta
// SOLO con predicciones fuera de muestra del modelo base entrenado en un
// corte temporal interno (75% del fit, día entero) — innerFit < innerCal <
// eval, estrictamente. El modelo base final se reentrena en el fit completo
// y su Platt (aprendido solo de datos anteriores) se aplica al eval.
// λ del Platt = 0.1 FIJO a priori (no se tunea en eval).
//
// Selección: LogLoss > Brier > ECE > Accuracy. Sin reglas manuales de
// empates/umbrales: Platt es una transformación estadística aprendida.
//
// Uso: node experimentos/fase_calibracion.js
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("./modelo_mu_exp");
const { entrenarFeatures, lambdasFeatures } = require("./modelo_stats_exp");
const { calcularElo } = require("./elo");
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

// Fracciones (0..1) del modelo base — matemáticamente idéntica a la de
// evaluar()/predecir() (la sanidad 1 verifica igualdad exacta de métricas).
function fracDe(vid, modelo, p) {
  if (vid === "V1") {
    const ligas = modelo.ligas || {};
    const base = ligas[p.liga] || { muHome: modelo.muHomeGlobal, muAway: modelo.muAwayGlobal };
    const lh = Math.exp(Math.log(base.muHome) + (modelo.att[p.home] ?? 0) - (modelo.def[p.away] ?? 0));
    const la = Math.exp(Math.log(base.muAway) + (modelo.att[p.away] ?? 0) - (modelo.def[p.home] ?? 0));
    return probsDesdeLambdas(lh, la);
  }
  const { lambdaHome, lambdaAway } = lambdasFeatures(modelo, p);
  return probsDesdeLambdas(lambdaHome, lambdaAway);
}

function evaluarCon(vid, modelo, partidos, platt = null) {
  const preds = partidos.map((p) => {
    const frac = fracDe(vid, modelo, p);
    const f2 = platt ? aplicarPlatt(platt, frac) : frac;
    return {
      fecha: p.fecha, home: p.home, away: p.away, liga: p.liga,
      probs: aPorcentajes(f2.home, f2.draw, f2.away, 1),
      real: realDe(p),
      marcador: `${p.goalsH}-${p.goalsA}`,
      argmax: argmax(aPorcentajes(f2.home, f2.draw, f2.away, 1)),
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

// LogLoss solo sobre un subconjunto de reales (p.ej. solo empates/visitantes)
function llSubconjunto(items, clase) {
  const sub = items.filter((x) => x.pred.real === clase);
  if (!sub.length) return null;
  const ll = sub.reduce((a, x) => a - Math.log(Math.max(1e-15, x.pred.probs[clase] / 100)), 0);
  return Math.round((ll / sub.length) * 10000) / 10000;
}

const MODELOS = [
  { id: "A", vid: "V1", desc: "V1 sin calibrar", calibrado: false, base: null },
  { id: "B", vid: "V1", desc: "V1 + Platt", calibrado: true, base: "A" },
  { id: "C", vid: "V2", desc: "V2 sin calibrar", calibrado: false, base: null },
  { id: "D", vid: "V2", desc: "V2 + Platt", calibrado: true, base: "C" },
];

(async () => {
  console.log("=========== FASE 2 — CALIBRACIÓN Platt (V1/V2) · SOLO train+val ===========");
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
  const nTrain = bloques.train.length;
  console.log(`TRAIN ${nTrain} | VAL ${bloques.val.length} | TV ${TV.length} | TEST ${bloques.test.length} (NO SE TOCA)`);

  // Elo K=32 (seleccionado en VAL en fase_elo) — cronológico, solo datos previos
  const { antes } = calcularElo(TV, { k: 32 });
  const augTV = TV.map((p, i) => ({ ...p, eloHome: antes[i].home, eloAway: antes[i].away }));

  // Ventanas idénticas a fases previas (corte día-estricto; último fijo)
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
  console.log(`ventanas idénticas: OFICIAL fit ${oficial.fit.length} eval ${oficial.eval.length} | W1-W4 eval ${ventanas.map((w) => w.eval.length).join("/")}`);

  const entrenar = (vid, fit) => (vid === "V1" ? entrenarExp(fit, "SPEC30") : entrenarFeatures(fit, "SPEC30", { elo: true, familias: [] }));

  // ---- ENTRENAMIENTOS + PLATT (corte interno día-estricto) ----
  const res = {}; // res[vid][win] = { raw:{...}, platt:{...} }
  const infoPlatt = {}; // infoPlatt[vid][win] = informe
  for (const vid of ["V1", "V2"]) {
    res[vid] = {}; infoPlatt[vid] = {};
    for (const win of [oficial, ...ventanas]) {
      // corte interno temporal: innerFit (75%) < innerCal (25%) — día entero
      const ci = cortar(win.fit, Math.floor(win.fit.length * FRAC_INNER));
      const innerFit = win.fit.slice(0, ci);
      const innerCal = win.fit.slice(ci);
      const okInner = innerFit.length > 0 && innerCal.length > 0 &&
        dia(innerFit[innerFit.length - 1]) < dia(innerCal[0]) &&
        dia(innerCal[innerCal.length - 1]) < dia(win.eval[0]);
      if (!okInner) throw new Error(`${vid}/${win.nombre}: violación de orden temporal interno`);

      // Platt ajustado con predicciones FUERA de muestra (modelo entrenado solo en innerFit)
      const mInner = entrenar(vid, innerFit);
      const muestras = innerCal.map((p) => ({ frac: fracDe(vid, mInner, p), real: realDe(p) }));
      const platt = ajustarPlatt(muestras, { lambda: LAMBDA_PLATT });

      // modelo base final reentrenado en el fit completo (como en fases previas)
      const mFull = entrenar(vid, win.fit);
      const raw = evaluarCon(vid, mFull, win.eval, null);
      const cal = evaluarCon(vid, mFull, win.eval, platt);
      const itemsRaw = win.eval.map((p, i) => ({ m: p, pred: raw.preds[i] }));
      const itemsCal = win.eval.map((p, i) => ({ m: p, pred: cal.preds[i] }));
      res[vid][win.nombre] = {
        raw: { metricas: raw.metricas, ext: extendidas(raw.preds), items: itemsRaw },
        platt: { metricas: cal.metricas, ext: extendidas(cal.preds), items: itemsCal },
      };
      infoPlatt[vid][win.nombre] = {
        ...plattParaInforme(platt),
        nInnerFit: innerFit.length,
        nInnerCal: innerCal.length,
        fechasInnerCal: [dia(innerCal[0]), dia(innerCal[innerCal.length - 1])],
        fechasEval: [dia(win.eval[0]), dia(win.eval[win.eval.length - 1])],
        precedeAEval: dia(innerCal[innerCal.length - 1]) < dia(win.eval[0]),
      };
    }
    console.log(`  ✓ ${vid}: Platt ajustado en 5 ventanas (λ=${LAMBDA_PLATT} fijo a priori, interno ${Math.round(FRAC_INNER * 100)}/${100 - Math.round(FRAC_INNER * 100)} día-estricto)`);
  }

  // ---- MONTAR RESULTADOS POR MODELO (A/B/C/D) ----
  const out = {};
  for (const M of MODELOS) {
    const src = res[M.vid];
    const modo = M.calibrado ? "platt" : "raw";
    out[M.id] = { ventanas: {}, desc: M.desc };
    for (const win of [oficial, ...ventanas]) {
      out[M.id].ventanas[win.nombre] = src[win.nombre][modo];
    }
    const poolItems = ventanas.flatMap((w) => out[M.id].ventanas[w.nombre].items);
    const poolPreds = poolItems.map((x) => x.pred);
    out[M.id].items = poolItems;
    out[M.id].pooled = { metricas: calcularMetricas(poolPreds), ext: extendidas(poolPreds) };
    if (M.base) {
      const bp = out[M.base].items;
      let cambia = 0;
      for (let i = 0; i < poolItems.length; i++) if (poolItems[i].pred.argmax !== bp[i].pred.argmax) cambia++;
      out[M.id].argmaxCambiados = { n: cambia, pct: r4(cambia / poolItems.length) };
    }
  }

  // ---- SANIDADES ----
  const san = {};
  const v1of = out.A.ventanas.OFICIAL.metricas;
  const oficialJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8")).backtest.val;
  san.v1OficialIgualFase1 = v1of.accuracy === oficialJson.accuracy && v1of.logLoss === oficialJson.logLoss && v1of.brier === oficialJson.brier && v1of.ece === oficialJson.ece;
  const v2of = out.C.ventanas.OFICIAL.metricas;
  san.v2OficialIgualFaseElo = Math.abs(v2of.logLoss - 1.0686) < 1e-9;
  san.v1PooledIgualFaseStats = Math.abs(out.A.pooled.metricas.logLoss - 1.11) < 1e-9;
  san.v2PooledIgualFaseStats = Math.abs(out.C.pooled.metricas.logLoss - 1.1045) < 1e-9;

  let sumasOk = true, finitosOk = true, noNegativos = true;
  for (const M of MODELOS) {
    for (const it of out[M.id].items.concat(out[M.id].ventanas.OFICIAL.items)) {
      const s = it.pred.probs.home + it.pred.probs.draw + it.pred.probs.away;
      if (s !== 100) sumasOk = false;
      for (const k of CLASES) {
        const v = it.pred.probs[k];
        if (!Number.isFinite(v)) finitosOk = false;
        if (v < 0) noNegativos = false;
      }
    }
  }
  san.probsSuman100Exacto = sumasOk;
  san.sinNaN = finitosOk;
  san.sinNegativos = noNegativos;
  san.ordenTemporalInterno = Object.values(infoPlatt).every((w) => Object.values(w).every((x) => x.precedeAEval && x.n > 0));
  san.plattSoloConDatosAnteriores = san.ordenTemporalInterno;
  san.testIntacto = bloques.test.length === 378;
  san.plattNuncaAjustadoEnEval = true; // estructural: muestras = innerCal ⊂ fit, nunca eval

  const sanOk = Object.values(san).every((x) => x === true);
  console.log("\n--- SANIDADES ---");
  for (const [k, v] of Object.entries(san)) console.log(`  ${v ? "✓" : "✗"} ${k}: ${v}`);
  if (!sanOk) throw new Error("Sanidades fallidas — abortar");
  console.log(`  ∑ SUMA100 exacta, sin NaN, sin negativos, orden temporal interno ✓, TEST ${bloques.test.length} intacto ✓`);

  // ---- TABLA 1 · PRINCIPAL (pooled W1-W4) ----
  const orden = [...MODELOS].sort((a, b) => out[a.id].pooled.metricas.logLoss - out[b.id].pooled.metricas.logLoss || out[a.id].pooled.metricas.brier - out[b.id].pooled.metricas.brier || out[a.id].pooled.metricas.ece - out[b.id].pooled.metricas.ece || out[b.id].pooled.metricas.accuracy - out[a.id].pooled.metricas.accuracy);
  const base = out.A.pooled.metricas;
  console.log("\n--- TABLA 1 · POOLED ROLLING (762 preds train+val) · selección LL > Brier > ECE > Acc ---");
  console.log("Modelo | Calibración         | Accuracy | LogLoss | Brier  | ECE    | Pred H | Pred E | Pred A");
  for (const M of orden) {
    const p = out[M.id].pooled;
    console.log(`${M.id}      | ${M.desc.padEnd(20)} | ${pct(p.metricas.accuracy)} | ${p.metricas.logLoss.toFixed(4)} | ${p.metricas.brier.toFixed(4)} | ${p.metricas.ece.toFixed(4)} | ${String(p.ext.cnt.home).padStart(6)} | ${String(p.ext.cnt.draw).padStart(6)} | ${String(p.ext.cnt.away).padStart(6)}`);
  }
  console.log("\n  probabilidades promedio y confianza media (P del argmax):");
  console.log("Modelo | Calibración         | P(H)    | P(E)    | P(A)    | conf media | argmax cambia vs base");
  for (const M of orden) {
    const p = out[M.id].pooled;
    const cam = M.base ? `${out[M.id].argmaxCambiados.n} (${pct(out[M.id].argmaxCambiados.pct, 1)})` : "— (base)";
    console.log(`${M.id}      | ${M.desc.padEnd(20)} | ${pct(p.ext.prom.home, 1).padStart(7)} | ${pct(p.ext.prom.draw, 1).padStart(7)} | ${pct(p.ext.prom.away, 1).padStart(7)} | ${pct(p.ext.conf, 1).padStart(10)} | ${cam}`);
  }

  // ---- TABLA 2 · Δ vs V1 ----
  console.log("\n--- TABLA 2 · Δ vs V1 sin calibrar (POOLED) · negativo = mejora ---");
  console.log("Modelo | Calibración         | Δ LogLoss | Δ Brier | Δ ECE   | Δ Accuracy");
  for (const M of orden) {
    const m = out[M.id].pooled.metricas;
    console.log(`${M.id}      | ${M.desc.padEnd(20)} | ${((m.logLoss - base.logLoss) >= 0 ? "+" : "") + (m.logLoss - base.logLoss).toFixed(4).padStart(8)} | ${((m.brier - base.brier) >= 0 ? "+" : "") + (m.brier - base.brier).toFixed(4).padStart(6)} | ${((m.ece - base.ece) >= 0 ? "+" : "") + (m.ece - base.ece).toFixed(4).padStart(6)} | ${((m.accuracy - base.accuracy) >= 0 ? "+" : "") + (m.accuracy - base.accuracy).toFixed(4).padStart(7)}`);
  }

  // ---- TABLA 3 · POR VENTANA ----
  console.log("\n--- TABLA 3 · LogLoss por ventana y consistencia ---");
  console.log("Modelo | OFICIAL  | W1      | W2      | W3      | W4      | media roll | ventanas gana a V1 | Platt gana a su base");
  for (const M of MODELOS) {
    const ws = ["W1", "W2", "W3", "W4"].map((w) => out[M.id].ventanas[w].metricas.logLoss);
    const ganaV1 = ["W1", "W2", "W3", "W4"].filter((w, i) => ws[i] < out.A.ventanas[w].metricas.logLoss).length;
    const ganaBase = M.base
      ? ["W1", "W2", "W3", "W4"].filter((w) => out[M.id].ventanas[w].metricas.logLoss < out[M.base].ventanas[w].metricas.logLoss).length + "/4"
      : "—";
    const oficialGana = out[M.id].ventanas.OFICIAL.metricas.logLoss < out.A.ventanas.OFICIAL.metricas.logLoss ? "sí" : (M.id === "A" ? "—" : "no");
    const media = ws.reduce((a, b) => a + b, 0) / 4;
    console.log(`${M.id}      | ${out[M.id].ventanas.OFICIAL.metricas.logLoss.toFixed(4)} | ${ws.map((x) => x.toFixed(4).padStart(7)).join(" | ")} | ${media.toFixed(4).padStart(8)}     | ${ganaV1}/4 rolling + OFICIAL ${oficialGana.padEnd(4)} | ${ganaBase}`);
  }

  // ---- TABLA 4 · CONFUSIÓN + TASAS ----
  console.log("\n--- TABLA 4 · Matriz de confusión y tasas por clase (POOLED) ---");
  for (const M of MODELOS) {
    const e = out[M.id].pooled.ext;
    console.log(`\n  ${M.id} (${M.desc})`);
    console.log("            REAL\n          H     E     A");
    console.log(`  PRED HOME   ${String(e.cm.home.home).padStart(3)}   ${String(e.cm.home.draw).padStart(3)}   ${String(e.cm.home.away).padStart(3)}`);
    console.log(`  PRED DRAW    ${String(e.cm.draw.home).padStart(3)}   ${String(e.cm.draw.draw).padStart(3)}   ${String(e.cm.draw.away).padStart(3)}`);
    console.log(`  PRED AWAY    ${String(e.cm.away.home).padStart(3)}   ${String(e.cm.away.draw).padStart(3)}   ${String(e.cm.away.away).padStart(3)}`);
    for (const k of CLASES) {
      const p = e.por[k];
      console.log(`    ${k.padEnd(4)} recall=${pct(p.recall)} precision=${pct(p.precision)} F1=${pct(p.f1)} (real ${p.realN} / pred ${p.predN})`);
    }
  }

  // ---- TABLA 5 · EMPATES Y VISITANTES ----
  console.log("\n--- TABLA 5 · Empates y visitantes específicos (POOLED) ---");
  console.log("Modelo | Calibración         | P(E)    | pred E | recall E | precision E | F1 E   | LL(solo E) | P(A)    | pred A | recall A | precision A | F1 A   | LL(solo A)");
  for (const M of MODELOS) {
    const o = out[M.id];
    const e = o.pooled.ext;
    const llE = llSubconjunto(o.items, "draw");
    const llA = llSubconjunto(o.items, "away");
    console.log(`${M.id}      | ${M.desc.padEnd(20)} | ${pct(e.prom.draw, 1).padStart(7)} | ${String(e.cnt.draw).padStart(6)} | ${pct(e.por.draw.recall).padStart(8)} | ${pct(e.por.draw.precision).padStart(11)} | ${pct(e.por.draw.f1).padStart(6)} | ${llE.toFixed(4).padStart(10)} | ${pct(e.prom.away, 1).padStart(7)} | ${String(e.cnt.away).padStart(6)} | ${pct(e.por.away.recall).padStart(8)} | ${pct(e.por.away.precision).padStart(11)} | ${pct(e.por.away.f1).padStart(6)} | ${llA.toFixed(4).padStart(10)}`);
  }

  // ---- TABLA 6 · POR LIGA ----
  const ligasN = [...new Set(out.A.items.map((x) => x.m.liga))]
    .map((lg) => ({ liga: lg, n: out.A.items.filter((x) => x.m.liga === lg).length }))
    .filter((x) => x.n >= 30)
    .sort((a, b) => b.n - a.n);
  const llLiga = (M, lg) => calcularMetricas(out[M].items.filter((x) => x.m.liga === lg).map((x) => x.pred)).logLoss;
  console.log("\n--- TABLA 6 · Por liga (pooled, n≥30) · ΔLL vs V1 (negativo = mejora) ---");
  console.log("Liga                                 | n   | LL_V1  | ΔB     | ΔC     | ΔD");
  const consistenciaLiga = {};
  for (const lg of ligasN) {
    const l1 = llLiga("A", lg.liga);
    const dB = r4(llLiga("B", lg.liga) - l1);
    const dC = r4(llLiga("C", lg.liga) - l1);
    const dD = r4(llLiga("D", lg.liga) - l1);
    console.log(`${lg.liga.padEnd(36)} | ${String(lg.n).padStart(3)} | ${l1.toFixed(4)} | ${((dB >= 0 ? "+" : "") + dB.toFixed(4)).padStart(6)} | ${((dC >= 0 ? "+" : "") + dC.toFixed(4)).padStart(6)} | ${((dD >= 0 ? "+" : "") + dD.toFixed(4)).padStart(6)}`);
    consistenciaLiga[lg.liga] = { n: lg.n, llV1: l1, deltaB: dB, deltaC: dC, deltaD: dD };
  }
  console.log("  consistencia (ligas n≥30 gana/pierde vs V1):");
  for (const M of MODELOS.filter((m) => m.base)) {
    const g = Object.values(consistenciaLiga).filter((x) => x["delta" + M.id] < 0).length;
    console.log(`    ${M.id} (${M.desc.padEnd(14)}): ${g} gana / ${ligasN.length - g} pierde`);
  }

  // ---- TABLA 7 · PARÁMETROS PLATT ----
  console.log("\n--- TABLA 7 · Parámetros Platt aprendidos (λ fijo=0.1; solo datos interiores anteriores) ---");
  for (const vid of ["V1", "V2"]) {
    for (const w of ["OFICIAL", "W1", "W2", "W3", "W4"]) {
      const pp = infoPlatt[vid][w];
      console.log(`  ${vid}/${w}: n=${pp.n} (innerFit ${pp.nInnerFit} / innerCal ${pp.nInnerCal}) | innerCal ${pp.fechasInnerCal[0]}→${pp.fechasInnerCal[1]} < eval ${pp.fechasEval[0]} ✓ | NLL innerCal ${pp.nllAntes}→${pp.nllDespues}`);
      console.log(`    W=${JSON.stringify(pp.W)}  b=${JSON.stringify(pp.b)}`);
    }
  }

  // ---- RANKING + GANADOR ----
  console.log("\n--- RANKING (pooled, regla LL > Brier > ECE > Acc) ---");
  orden.forEach((M, i) => {
    const m = out[M.id].pooled.metricas;
    console.log(`  ${i + 1}º ${M.id} (${M.desc}) — LL ${m.logLoss.toFixed(4)} | Brier ${m.brier.toFixed(4)} | ECE ${m.ece.toFixed(4)} | Acc ${pct(m.accuracy)}`);
  });
  const ganador = orden[0];
  const dLL = r4(out[ganador.id].pooled.metricas.logLoss - base.logLoss);
  console.log(`\n--- GANADOR: ${ganador.id} (${ganador.desc}) — ΔLL ${dLL} vs V1 ---`);

  // ---- RESUMEN 1-7 ----
  const llA = out.A.pooled.metricas, llB = out.B.pooled.metricas, llC = out.C.pooled.metricas, llD = out.D.pooled.metricas;
  const mejoraPlattV1 = llB.logLoss < llA.logLoss;
  const mejoraPlattV2 = llD.logLoss < llC.logLoss;
  const v2SuperaTrasCal = llC.logLoss < llA.logLoss && llD.logLoss < llB.logLoss;
  const mejoraECE = llB.ece < llA.ece || llD.ece < llC.ece;
  const mejoraLL = (llB.logLoss < llA.logLoss || llD.logLoss < llC.logLoss);
  const mejoraBrier = llB.brier < llA.brier || llD.brier < llC.brier;
  console.log("\n=========== RESUMEN ===========");
  console.log(`1. ¿Platt mejora V1 (LL)?                ${mejoraPlattV1 ? "SÍ" : "NO"}  (A ${llA.logLoss.toFixed(4)} → B ${llB.logLoss.toFixed(4)})`);
  console.log(`2. ¿Platt mejora V2 (LL)?                ${mejoraPlattV2 ? "SÍ" : "NO"}  (C ${llC.logLoss.toFixed(4)} → D ${llD.logLoss.toFixed(4)})`);
  console.log(`3. ¿V2 sigue superando a V1 tras calibrar? ${v2SuperaTrasCal ? "SÍ" : "NO"}  (C<A: ${llC.logLoss < llA.logLoss}, D<B: ${llD.logLoss < llB.logLoss})`);
  console.log(`4. ¿Calibración mejora ECE?              ${mejoraECE ? "SÍ" : "NO"}  (B ${llB.ece.toFixed(4)} vs A ${llA.ece.toFixed(4)}; D ${llD.ece.toFixed(4)} vs C ${llC.ece.toFixed(4)})`);
  console.log(`5. ¿Mejora LL/Brier?                     LL: ${mejoraLL ? "SÍ" : "NO"} | Brier: ${mejoraBrier ? "SÍ" : "NO"}  (B ${llB.brier.toFixed(4)} vs A ${llA.brier.toFixed(4)}; D ${llD.brier.toFixed(4)} vs C ${llC.brier.toFixed(4)})`);
  console.log(`6. Candidato para evaluación FINAL:      ${ganador.id} (${ganador.desc})`);
  console.log(`7. TEST intacto: SÍ ✓ — ${bloques.test.length} partidos nunca evaluados; prediccion_poisson.json NO modificado.`);

  // ---- INFORME JSON ----
  const informe = {
    generado: new Date().toISOString(),
    nota: "TEST no evaluado. prediccion_poisson.json no modificado. Platt multicategoría (softmax sobre log-probs) con λ=0.1 FIJO a priori; ajuste solo sobre predicciones fuera de muestra de un corte temporal interno día-estricto del fit (innerFit<innerCal<eval). Sin umbrales ni reglas manuales de empates.",
    esquema: { train: nTrain, val: bloques.val.length, tv: TV.length, test: bloques.test.length, lambdaPlatt: LAMBDA_PLATT, fracInner: FRAC_INNER, elo: "K=32 (seleccionado en VAL en fase_elo)" },
    sanidades: san,
    ventanas: [oficial, ...ventanas].map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: dia(w.eval[0]), hasta: dia(w.eval[w.eval.length - 1]) })),
    platt: infoPlatt,
    modelos: {},
    porLiga: consistenciaLiga,
    ranking: orden.map((M, i) => ({ puesto: i + 1, id: M.id, desc: M.desc, ...out[M.id].pooled.metricas })),
    ganador: { id: ganador.id, desc: ganador.desc, deltaLL: dLL },
    resumen: { plattMejoraV1: mejoraPlattV1, plattMejoraV2: mejoraPlattV2, v2SuperaTrasCalibrar: v2SuperaTrasCal, mejoraECE, mejoraLL, mejoraBrier, candidato: ganador.id, testIntacto: true },
  };
  for (const M of MODELOS) {
    const o = out[M.id];
    informe.modelos[M.id] = {
      desc: M.desc,
      oficial: o.ventanas.OFICIAL.metricas,
      pooled: {
        accuracy: o.pooled.metricas.accuracy, logLoss: o.pooled.metricas.logLoss,
        brier: o.pooled.metricas.brier, ece: o.pooled.metricas.ece, probRealMedia: o.pooled.metricas.probRealMedia,
        prob: o.pooled.ext.prom, pred: o.pooled.ext.cnt, confianzaMedia: r4(o.pooled.ext.conf),
        confusion: o.pooled.ext.cm, porClase: o.pooled.ext.por,
      },
      llEmpates: llSubconjunto(o.items, "draw"),
      llVisitantes: llSubconjunto(o.items, "away"),
      porVentana: Object.fromEntries(Object.entries(o.ventanas).map(([k, v]) => [k, { accuracy: v.metricas.accuracy, logLoss: v.metricas.logLoss, brier: v.metricas.brier, ece: v.metricas.ece }])),
      deltaVsV1: {
        logLoss: r4(o.pooled.metricas.logLoss - base.logLoss),
        brier: r4(o.pooled.metricas.brier - base.brier),
        ece: r4(o.pooled.metricas.ece - base.ece),
        accuracy: r4(o.pooled.metricas.accuracy - base.accuracy),
      },
      argmaxCambiadosVsBase: o.argmaxCambiados || null,
    };
  }
  const ruta = path.join(__dirname, "informes", "fase_calibracion.json");
  fs.writeFileSync(ruta, JSON.stringify(informe, null, 2));
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO (reservado para la evaluación final única).");

  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
