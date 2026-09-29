// ---------------------------------------------------------------------------
// FASE 3.3 — EXPERIMENTOS A–G sobre V1 (TRAIN+VAL; TEST no se carga).
//
// Mismo dataset, mismos splits (fechas oficiales), mismas ventanas rolling
// día-estricto y misma regla de selección que las fases previas:
//   selección en POOLED: LogLoss > Brier > ECE > Accuracy + consistencia.
//
// A: V1 + Elo (K=32, ya seleccionado en VAL en fase_elo)
// B: V1 + xG (raw y norm — ambos ya probados en fase_stats)
// C: V1 + remates totales norm (V5T)
// D: V1 + tiros al arco (raw y norm)
// E: V1 + forma5 (covariable simple, sin Elo — nuevo)
// F: V1 + localía ajustada (x_hfa = +1 constante vía Δelo=±200 — nuevo)
// G: V1 + Elo + xG — SOLO se ejecuta si el mejor B mejora a V1 en pooled LL.
//
// V1_BETA (producción) no usa este código. Nada en experimentos/, services/ ni
// modelos/ se modifica. TEST jamás se carga (SQL/fecha <= fin de VAL).
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { entrenarConFeatures, lambdasExp } = require("../experimentos/modelo_elo_exp");
const { entrenarFeatures, lambdasFeatures } = require("../experimentos/modelo_stats_exp");
const { cargarPartidosConStats, construirFeatures } = require("../experimentos/stats_features");
const { calcularElo } = require("../experimentos/elo");
const { evaluar, calcularMetricas } = require("../services/prediccion/backtest");
const { probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");
const {
  CLASES, r4, pct, argmax, realDe, dia, partirTV, construirVentanas, evaluarExp,
  extendidas, llSubconjunto, calcularFormas, guardarInforme,
} = require("./comun");

// evaluarFeatures — copia de fase_stats.js:21-33 (λ con covariables de stats)
function evaluarFeatures(modelo, partidos) {
  const predicciones = partidos.map((p) => {
    const { lambdaHome, lambdaAway } = lambdasFeatures(modelo, p);
    const { home, draw, away } = probsDesdeLambdas(lambdaHome, lambdaAway);
    return {
      fecha: p.fecha, id: p.id, home: p.home, away: p.away, liga: p.liga,
      probs: aPorcentajes(home, draw, away, 1),
      real: realDe(p),
      marcador: `${p.goalsH}-${p.goalsA}`,
    };
  });
  return { predicciones, metricas: calcularMetricas(predicciones) };
}

const FAM = {
  xgNorm: { nombre: "xg", forL: "xgnF_L", agL: "xgnA_L", forV: "xgnF_V", agV: "xgnA_V" },
  xgRaw: { nombre: "xg", forL: "xgrF_L", agL: "xgrA_L", forV: "xgrF_V", agV: "xgrA_V" },
  tsNorm: { nombre: "ts", forL: "tsnF_L", agL: "tsnA_L", forV: "tsnF_V", agV: "tsnA_V" },
  stNorm: { nombre: "st", forL: "stnF_L", agL: "stnA_L", forV: "stnF_V", agV: "stnA_V" },
  stRaw: { nombre: "st", forL: "strF_L", agL: "strA_L", forV: "strF_V", agV: "strA_V" },
};

const VARIANTES = [
  { id: "V1", desc: "base V1 (SPEC30)", tipo: "mu", cfg: null, map: (p) => p },
  { id: "A", desc: "V1 + Elo (K=32)", tipo: "elo", cfg: { conElo: true }, map: (p) => p },
  { id: "B_raw", desc: "V1 + xG crudo", tipo: "stats", cfg: { elo: false, familias: [FAM.xgRaw] }, map: (p) => p },
  { id: "B_norm", desc: "V1 + xG norm liga", tipo: "stats", cfg: { elo: false, familias: [FAM.xgNorm] }, map: (p) => p },
  { id: "C_norm", desc: "V1 + remates totales norm", tipo: "stats", cfg: { elo: false, familias: [FAM.tsNorm] }, map: (p) => p },
  { id: "D_raw", desc: "V1 + tiros al arco crudo", tipo: "stats", cfg: { elo: false, familias: [FAM.stRaw] }, map: (p) => p },
  { id: "D_norm", desc: "V1 + tiros al arco norm", tipo: "stats", cfg: { elo: false, familias: [FAM.stNorm] }, map: (p) => p },
  { id: "E", desc: "V1 + forma5", tipo: "elo", cfg: { conForma: true }, map: (p) => p },
  { id: "F", desc: "V1 + localía ajustada (x_hfa=+1 vía Δelo ±200)", tipo: "elo", cfg: { conElo: true }, map: (p) => ({ ...p, eloHome: 200, eloAway: -200 }) },
];

function entrenarV(V, fit) {
  const f = fit.map(V.map);
  if (V.tipo === "mu") return entrenarExp(f, "SPEC30");
  if (V.tipo === "elo") return entrenarConFeatures(f, "SPEC30", V.cfg);
  return entrenarFeatures(f, "SPEC30", V.cfg);
}
function evaluarV(V, modelo, ev) {
  const e = ev.map(V.map);
  if (V.tipo === "mu") return evaluar(modelo, e);
  if (V.tipo === "elo") return evaluarExp(modelo, e);
  return evaluarFeatures(modelo, e);
}

(async () => {
  console.log("=========== FASE 3.3 — EXPERIMENTOS A–G · solo TRAIN+VAL (TEST no cargado) ===========");
  const todos = (await cargarPartidosConStats(pool)).sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || a.id - b.id);
  const valHasta = require("../modelos/prediccion_poisson.json").backtest.split.val.hasta.slice(0, 10);
  const tvBase = todos.filter((p) => dia(p) <= valHasta); // TEST fuera por fecha
  const { TV, nTrain } = partirTV(tvBase);
  console.log(`TV ${TV.length} (nTrain=${nTrain}); TEST no cargado`);

  // covariables: stats (día estricto) + Elo K=32 + forma5 histórica
  const { items: conFeatures } = construirFeatures(TV);
  const { antes } = calcularElo(TV, { k: 32 });
  const formaTV = calcularFormas(TV);
  const augTV = conFeatures.map((p, i) => ({
    ...p, eloHome: antes[i].home, eloAway: antes[i].away, formaHome: formaTV[i].home, formaAway: formaTV[i].away,
  }));
  const { oficial, ventanas } = construirVentanas(augTV, nTrain);
  console.log(`ventanas idénticas a fases previas: OFICIAL fit ${oficial.fit.length} eval ${oficial.eval.length} | W1-4 eval ${ventanas.map((w) => w.eval.length).join("/")}`);

  const resultados = {};
  const correr = (V) => {
    resultados[V.id] = { ventanas: {}, coef: {}, desc: V.desc };
    for (const win of [oficial, ...ventanas]) {
      const modelo = entrenarV(V, win.fit);
      if (modelo.cov) {
        const malos = Object.entries(modelo.cov).filter(([, v]) => !Number.isFinite(v.bf) || !Number.isFinite(v.ba) || Math.abs(v.bf) > 50 || Math.abs(v.ba) > 50);
        if (malos.length) throw new Error(`${V.id}/${win.nombre}: coeficientes no finitos en ${malos.map((x) => x[0]).join(",")}`);
      }
      const ev = evaluarV(V, modelo, win.eval);
      const items = win.eval.map((p, i) => ({ m: p, pred: ev.predicciones[i] }));
      resultados[V.id].ventanas[win.nombre] = { metricas: ev.metricas, ext: extendidas(ev.predicciones), items };
      if (V.id !== "V1") resultados[V.id].coef[win.nombre] = { beta: modelo.beta ?? null, gamma: modelo.gamma ?? null, betaE: modelo.betaE ?? null, cov: modelo.cov ?? null };
    }
    const poolItems = ventanas.flatMap((w) => resultados[V.id].ventanas[w.nombre].items);
    const poolPreds = poolItems.map((x) => x.pred);
    resultados[V.id].items = poolItems;
    resultados[V.id].pooled = { metricas: calcularMetricas(poolPreds), ext: extendidas(poolPreds) };
    console.log(`  ✓ ${V.id} (${V.desc}) en ${ventanas.length + 1} ventanas`);
  };

  for (const V of VARIANTES) correr(V);

  // ---- G: condicionado a que el mejor B mejore a V1 en pooled LL ----
  const base = resultados.V1.pooled.metricas;
  const mejorB = ["B_raw", "B_norm"].sort((a, b) => resultados[a].pooled.metricas.logLoss - resultados[b].pooled.metricas.logLoss)[0];
  const gOk = resultados[mejorB].pooled.metricas.logLoss < base.logLoss;
  let Vg = null;
  if (gOk) {
    const fam = mejorB === "B_raw" ? FAM.xgRaw : FAM.xgNorm;
    Vg = { id: "G", desc: `V1 + Elo + xG (${mejorB === "B_raw" ? "raw" : "norm"})`, tipo: "stats", cfg: { elo: true, familias: [fam] }, map: (p) => p };
    correr(Vg);
  } else {
    console.log(`\nG OMITIDO: el mejor xG (${mejorB}, ΔLL ${r4(resultados[mejorB].pooled.metricas.logLoss - base.logLoss)}) no mejora a V1 → sin justificación para continuar.`);
  }
  const TODOS = [...VARIANTES, ...(Vg ? [Vg] : [])];

  // ---- SANIDADES ----
  const oficialJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8")).backtest.val;
  const v1of = resultados.V1.ventanas.OFICIAL.metricas;
  const ok1 = v1of.accuracy === oficialJson.accuracy && v1of.logLoss === oficialJson.logLoss && v1of.brier === oficialJson.brier;
  const ok2 = Math.abs(resultados.A.ventanas.OFICIAL.metricas.logLoss - 1.0686) < 1e-9;
  const fasePrev = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "experimentos", "informes", "fase_stats.json"), "utf8"));
  const pares = { V1: "V1", A: "V2", B_raw: "V4raw", B_norm: "V4", C_norm: "V5T", D_raw: "V5Sraw", D_norm: "V5S" };
  const repro = {};
  for (const [mine, prev] of Object.entries(pares)) {
    const a = resultados[mine].ventanas.OFICIAL.metricas.logLoss;
    const b = fasePrev.modelos[prev].oficial.logLoss;
    repro[mine] = { prev, igual: Math.abs(a - b) < 1e-12, ll: a, llPrev: b };
  }
  const ventIguales = JSON.stringify(fasePrev.ventanas.map((v) => [v.fit, v.eval, v.desde, v.hasta]))
    === JSON.stringify(ventanas.map((w) => [w.fit.length, w.eval.length, dia(w.eval[0]), dia(w.eval[w.eval.length - 1])]));
  console.log(`\nSANIDAD 1 · V1/OFICIAL == modelo oficial JSON: ${ok1 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 2 · A/OFICIAL == fase_elo V2 (LL 1.0686): ${ok2 ? "SÍ ✓" : `NO ✗ (${resultados.A.ventanas.OFICIAL.metricas.logLoss})`}`);
  console.log(`SANIDAD 3 · reproducción exacta de fase_stats (V4/V5…): ${Object.values(repro).every((x) => x.igual) ? "SÍ ✓" : "NO ✗ → " + Object.entries(repro).filter(([, v]) => !v.igual).map(([k, v]) => `${k}(${v.ll} vs ${v.llPrev})`).join(", ")}`);
  console.log(`SANIDAD 4 · ventanas idénticas a fase_stats: ${ventIguales ? "SÍ ✓" : "NO ✗"}`);
  if (!ok1) throw new Error("V1/OFICIAL no reproduce al modelo oficial — detener.");
  if (Vg) { /* G ejecutado bajo condición */ }

  const orden = TODOS.map((V) => V.id).sort((a, b) => resultados[a].pooled.metricas.logLoss - resultados[b].pooled.metricas.logLoss || resultados[b].pooled.metricas.brier - resultados[a].pooled.metricas.brier || resultados[b].pooled.metricas.ece - resultados[a].pooled.metricas.ece || resultados[b].pooled.metricas.accuracy - resultados[a].pooled.metricas.accuracy);

  // ---- TABLA 1: POOLED ----
  console.log("\n--- TABLA 1 · POOLED ROLLING (train+val, ~762 predicciones) · selección LL > Brier > ECE > Acc ---");
  console.log("Modelo  | Accuracy | LogLoss | Brier  | ECE    | Pred H | Pred E | Pred A | P(H)  | P(E)  | P(A)");
  for (const id of orden) {
    const { metricas: m, ext } = resultados[id].pooled;
    console.log(`${id.padEnd(7)} | ${pct(m.accuracy)} | ${m.logLoss.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.ece.toFixed(4)} | ${String(ext.cnt.home).padStart(6)} | ${String(ext.cnt.draw).padStart(6)} | ${String(ext.cnt.away).padStart(6)} | ${pct(ext.prom.home, 1)} | ${pct(ext.prom.draw, 1)} | ${pct(ext.prom.away, 1)}  ← ${resultados[id].desc}`);
  }

  // ---- TABLA 2: Δ vs V1 ----
  console.log("\n--- TABLA 2 · Δ vs V1 (POOLED) · negativo = mejora ---");
  console.log("Modelo  | Δ LogLoss | Δ Brier | Δ ECE   | Δ Accuracy");
  for (const id of orden) {
    const m = resultados[id].pooled.metricas;
    const d = (a, b) => (a - b >= 0 ? "+" : "") + (a - b).toFixed(4);
    console.log(`${id.padEnd(7)} | ${d(m.logLoss, base.logLoss).padStart(9)} | ${d(m.brier, base.brier).padStart(7)} | ${d(m.ece, base.ece).padStart(7)} | ${d(m.accuracy, base.accuracy).padStart(10)}`);
  }

  // ---- TABLA 3: por ventana + consistencia ----
  console.log("\n--- TABLA 3 · LogLoss por ventana y consistencia (¿cuántas ventanas gana a V1?) ---");
  console.log("Modelo  | OFICIAL  | W1      | W2      | W3      | W4      | media roll | ventanas gana a V1");
  const consist = {};
  for (const id of orden) {
    const cells = ventanas.map((w) => resultados[id].ventanas[w.nombre].metricas.logLoss);
    const media_ = cells.reduce((a, b) => a + b, 0) / cells.length;
    const v1cells = ventanas.map((w) => resultados.V1.ventanas[w.nombre].metricas.logLoss);
    let gana = 0;
    cells.forEach((c, i) => { if (c < v1cells[i]) gana += 1; });
    const ganaOf = resultados[id].ventanas.OFICIAL.metricas.logLoss < resultados.V1.ventanas.OFICIAL.metricas.logLoss ? "sí" : "no";
    consist[id] = { rolling: gana, oficial: ganaOf === "sí" };
    console.log(`${id.padEnd(7)} | ${resultados[id].ventanas.OFICIAL.metricas.logLoss.toFixed(4)} | ${cells.map((c) => c.toFixed(4)).join(" | ")} | ${media_.toFixed(4)}     | ${gana}/4 rolling + OFICIAL ${ganaOf}`);
  }

  // ---- TABLA 4: coeficientes aprendidos ----
  console.log("\n--- TABLA 4 · COEFICIENTES APRENDIDOS (por ventana) ---");
  for (const id of orden) {
    if (id === "V1") continue;
    const partes = Object.entries(resultados[id].coef).map(([w, c]) => {
      const bits = [];
      if (c.beta !== null) bits.push(`β=${c.beta}`);
      if (c.gamma !== null) bits.push(`γ=${c.gamma}`);
      if (c.betaE !== null) bits.push(`βE=${c.betaE}`);
      if (c.cov) for (const [k, v] of Object.entries(c.cov)) bits.push(`${k}:bf=${r4(v.bf)},ba=${r4(v.ba)}`);
      return `${w}: ${bits.join(" ")}`;
    });
    console.log(`  ${id}: ${partes.join(" | ")}`);
  }

  // ---- TABLA 5: per-liga Δ del ganador vs V1 (n≥30) ----
  const ganador = orden[0];
  const porLiga = new Map();
  resultados.V1.items.forEach((x, i) => {
    if (!porLiga.has(x.m.liga)) porLiga.set(x.m.liga, []);
    porLiga.get(x.m.liga).push(i);
  });
  console.log(`\n--- TABLA 5 · Por liga (pooled, n≥30): ΔLL ${ganador} vs V1 · negativo = mejora ---`);
  console.log(`liga                                  | n   | LL_V1  | Δ${ganador}`);
  const ligaFilas = [];
  let ganaLigas = 0, pierdeLigas = 0;
  for (const [liga, idxs] of porLiga) {
    if (idxs.length < 30) continue;
    const llV1 = calcularMetricas(idxs.map((i) => resultados.V1.items[i].pred)).logLoss;
    const llG = calcularMetricas(idxs.map((i) => resultados[ganador].items[i].pred)).logLoss;
    const d = r4(llG - llV1);
    if (d < 0) ganaLigas += 1; else pierdeLigas += 1;
    ligaFilas.push({ liga, n: idxs.length, llV1: r4(llV1), delta: d });
    console.log(`${liga.slice(0, 37).padEnd(37)} | ${String(idxs.length).padStart(3)} | ${llV1.toFixed(4)} | ${(d >= 0 ? "+" : "") + d.toFixed(4)}`);
  }
  console.log(`  ${ganador} gana/pierde vs V1 en ${ganaLigas}/${pierdeLigas} ligas (n≥30)`);

  // ---- GANADOR POR REGLA ----
  const dLL = r4(resultados[ganador].pooled.metricas.logLoss - base.logLoss);
  console.log(`\n--- GANADOR POR REGLA (LL > Brier > ECE > Acc): ${ganador} (${resultados[ganador].desc}) — ΔLL ${dLL} vs V1 ---`);

  // ---- INFORME ----
  const informe = {
    generado: new Date().toISOString(),
    nota: "TEST no evaluado. K Elo=32 (seleccionado en VAL en fase_elo). F = localía ajustada (x_hfa=+1 vía Δelo ±200 constante). E = forma5 sin Elo. G solo si el mejor B gana en pooled LL.",
    sanidad: { v1OficialIgualJson: ok1, aIgualFaseElo10686: ok2, reproduccionFaseStats: repro, ventanasIgualesFaseStats: ventIguales },
    ejecutados: TODOS.map((V) => V.id),
    gEjecutado: !!Vg,
    gMotivo: Vg ? `mejor xG (${mejorB}) mejora a V1 en pooled LL` : `mejor xG (${mejorB}) NO mejora a V1 en pooled LL (Δ ${r4(resultados[mejorB].pooled.metricas.logLoss - base.logLoss)})`,
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: dia(w.eval[0]), hasta: dia(w.eval[w.eval.length - 1]) })),
    ganador: { id: ganador, desc: resultados[ganador].desc, deltaLL: dLL, consistencia: consist[ganador] },
    consistenciaLiga: { gana: ganaLigas, pierde: pierdeLigas },
    porLigaGanador: ligaFilas,
    modelos: {},
  };
  for (const id of orden) {
    const rr = resultados[id];
    informe.modelos[id] = {
      desc: rr.desc,
      oficial: rr.ventanas.OFICIAL.metricas,
      pooled: {
        accuracy: r4(rr.pooled.metricas.accuracy), logLoss: r4(rr.pooled.metricas.logLoss),
        brier: rr.pooled.metricas.brier, ece: rr.pooled.metricas.ece,
        prob: rr.pooled.ext.prom, pred: rr.pooled.ext.cnt,
      },
      confusion: rr.pooled.ext.cm,
      porClase: Object.fromEntries(CLASES.map((c) => {
        const t = rr.pooled.ext.por[c];
        return [c, { recall: t.recall === null ? null : r4(t.recall), precision: t.precision === null ? null : r4(t.precision), f1: t.f1 === null ? null : r4(t.f1) }];
      })),
      llEmpates: llSubconjunto(rr.items.map((x) => x.pred), "draw"),
      llVisitantes: llSubconjunto(rr.items.map((x) => x.pred), "away"),
      porVentana: Object.fromEntries(Object.entries(rr.ventanas).map(([k, x]) => [k, { accuracy: r4(x.metricas.accuracy), logLoss: r4(x.metricas.logLoss), brier: x.metricas.brier, ece: x.metricas.ece }])),
      consistencia: consist[id],
      coeficientes: rr.coef,
      deltaVsV1: {
        logLoss: r4(rr.pooled.metricas.logLoss - base.logLoss),
        brier: r4(rr.pooled.metricas.brier - base.brier),
        ece: r4(rr.pooled.metricas.ece - base.ece),
        accuracy: r4(rr.pooled.metricas.accuracy - base.accuracy),
      },
    };
  }
  const ruta = guardarInforme("fase3_3_experimentos.json", informe);
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO (reservado para el candidato final).");
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
