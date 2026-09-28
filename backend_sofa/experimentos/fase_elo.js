// FASE 2 — V2 (V1 + Elo) y V3 (V1 + Elo + forma reciente) vs V1.
// Mismos splits temporales que FASE 0 (OFICIAL + 4 ventanas rolling).
// SOLO TRAIN+VAL. El TEST NUNCA se evalúa aquí.
// Selección de K solo en VALIDACIÓN. Sin reglas manuales de países/ligas.
//
// Uso: node experimentos/fase_elo.js
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("./modelo_mu_exp");
const { entrenarConFeatures, lambdasExp } = require("./modelo_elo_exp");
const { calcularElo } = require("./elo");
const { evaluar, calcularMetricas, dividirTemporal } = require("../services/prediccion/backtest");
const { probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");

const CLASES = ["home", "draw", "away"];
const r4 = (x) => Math.round(x * 10000) / 10000;
const pct = (x, d = 2) => (x * 100).toFixed(d) + "%";
const argmax = (p) => CLASES.reduce((a, b) => (p[a] >= p[b] ? a : b));
const realDe = (p) => (p.goalsH > p.goalsA ? "home" : p.goalsH === p.goalsA ? "draw" : "away");

// Evaluación con covariables del propio partido (λ idéntica a la del entrenamiento)
function evaluarExp(modelo, partidos) {
  const predicciones = partidos.map((p) => {
    const { lambdaHome, lambdaAway } = lambdasExp(modelo, p);
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

// Forma reciente: puntos ÷ (3·n) de los últimos ≤5 partidos ANTERIORES al
// partido objetivo. Sin historial → 0 (neutral, documentado; no se inventa
// rendimiento). Solo usa partidos previos dentro de train+val.
function calcularFormas(tv) {
  const hist = new Map();
  const antes = [];
  const tasa = (a) => {
    if (!a || !a.length) return 0;
    const ult = a.slice(-5);
    return ult.reduce((x, y) => x + y, 0) / (3 * ult.length);
  };
  for (const p of tv) {
    antes.push({ home: tasa(hist.get(p.home)), away: tasa(hist.get(p.away)) });
    const pH = p.goalsH > p.goalsA ? 3 : p.goalsH === p.goalsA ? 1 : 0;
    const pA = p.goalsA > p.goalsH ? 3 : p.goalsA === p.goalsH ? 1 : 0;
    for (const [eq, r] of [[p.home, pH], [p.away, pA]]) {
      if (!hist.has(eq)) hist.set(eq, []);
      const arr = hist.get(eq);
      arr.push(r);
      if (arr.length > 10) arr.shift();
    }
  }
  return antes;
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

(async () => {
  console.log("=========== FASE 2 — V1 vs V2 (+Elo) vs V3 (+Elo+forma) · SOLO train+val ===========");
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
  const nTrain = bloques.train.length;
  console.log(`TRAIN ${nTrain} | VAL ${bloques.val.length} | TV ${TV.length} | TEST ${bloques.test.length} (NO SE TOCA)`);

  const formaTV = calcularFormas(TV); // independiente de K

  // ---- SELECCIÓN DE K SOLO EN VALIDACIÓN (OFICIAL: fit TRAIN → eval VAL) ----
  console.log("\n--- SELECCIÓN DE K (Elo) · solo VALIDACIÓN · misma muestra que FASE 1 ---");
  const selK = [];
  for (const k of [16, 32, 64]) {
    const { antes } = calcularElo(TV, { k });
    const tvK = TV.map((p, i) => ({ ...p, eloHome: antes[i].home, eloAway: antes[i].away, formaHome: formaTV[i].home, formaAway: formaTV[i].away }));
    const modelo = entrenarConFeatures(tvK.slice(0, nTrain), "SPEC30", { conElo: true });
    const ev = evaluarExp(modelo, tvK.slice(nTrain));
    selK.push({ k, ...ev.metricas, beta: modelo.beta });
  }
  const ordenK = [...selK].sort((a, b) => a.logLoss - b.logLoss || a.brier - b.brier || a.ece - b.ece || b.accuracy - a.accuracy);
  for (const s of selK) {
    console.log(`  K=${String(s.k).padStart(2)} → VAL: acc=${pct(s.accuracy)} LL=${s.logLoss.toFixed(4)} Brier=${s.brier.toFixed(4)} ECE=${s.ece.toFixed(4)} β=${s.beta}`);
  }
  const mejorK = ordenK[0].k;
  console.log(`  → K elegido (LL→Brier→ECE→Acc): ${mejorK}`);

  // ---- AUGMENTAR TV CON ELO (K elegido) + FORMA ----
  const { antes: antesFinal, final: eloFinal } = calcularElo(TV, { k: mejorK });
  const augTV = TV.map((p, i) => ({
    ...p,
    eloHome: antesFinal[i].home, eloAway: antesFinal[i].away,
    formaHome: formaTV[i].home, formaAway: formaTV[i].away,
  }));
  const augTrain = augTV.slice(0, nTrain);
  const augVal = augTV.slice(nTrain);

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
  const oficial = { nombre: "OFICIAL", fit: augTrain, eval: augVal };
  console.log("\nventanas (idénticas a FASE 0):");
  for (const v of [oficial, ...ventanas]) {
    console.log(`  ${v.nombre}: fit ${v.fit.length} → eval ${v.eval.length} (${dia(v.eval[0])}→${dia(v.eval[v.eval.length - 1])})`);
  }

  const MODELOS = [
    { id: "V1", desc: "V1 (SPEC30) actual", train: (fit) => entrenarExp(fit, "SPEC30"), ev: evaluar },
    { id: "V2", desc: "V1 + Elo (β·Δelo/400)", train: (fit) => entrenarConFeatures(fit, "SPEC30", { conElo: true }), ev: evaluarExp },
    { id: "V3", desc: "V1 + Elo + forma5", train: (fit) => entrenarConFeatures(fit, "SPEC30", { conElo: true, conForma: true }), ev: evaluarExp },
  ];

  const resultados = {}; // id → { ventanas, pooled:{metricas, ext, items}, coef }
  for (const M of MODELOS) {
    resultados[M.id] = { ventanas: {}, coef: {} };
    for (const win of [oficial, ...ventanas]) {
      const modelo = M.train(win.fit);
      const ev = M.ev(modelo, win.eval);
      const items = win.eval.map((p, i) => ({ m: p, pred: ev.predicciones[i] }));
      resultados[M.id].ventanas[win.nombre] = { metricas: ev.metricas, ext: extendidas(ev.predicciones), items };
      if (M.id !== "V1") resultados[M.id].coef[win.nombre] = { beta: modelo.beta, gamma: modelo.gamma || 0 };
    }
    const poolItems = ventanas.flatMap((w) => resultados[M.id].ventanas[w.nombre].items);
    const poolPreds = poolItems.map((x) => x.pred);
    resultados[M.id].items = poolItems;
    resultados[M.id].pooled = { metricas: calcularMetricas(poolPreds), ext: extendidas(poolPreds) };
    console.log(`  ✓ ${M.id} entrenada en ${ventanas.length + 1} ventanas`);
  }

  // ---- SANIDADES ----
  const v1of = resultados.V1.ventanas.OFICIAL.metricas;
  const oficialJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8")).backtest.val;
  const ok1 = v1of.accuracy === oficialJson.accuracy && v1of.logLoss === oficialJson.logLoss && v1of.brier === oficialJson.brier;
  console.log(`\nSANIDAD 1 · V1/OFICIAL == FASE 1: ${ok1 ? "SÍ ✓" : `NO ✗ (${v1of.logLoss} vs ${oficialJson.logLoss})`}`);
  // evaluarExp con modelo sin covariables debe reproducir a evaluar (mismo λ y redondeo)
  const mV1 = entrenarExp(augTrain, "SPEC30");
  const eA = evaluar(mV1, augVal.slice(0, 30)).predicciones;
  const eB = evaluarExp({ ...mV1, conElo: false, conForma: false }, augVal.slice(0, 30)).predicciones;
  const ok2 = eA.every((p, i) => p.probs.home === eB[i].probs.home && p.probs.draw === eB[i].probs.draw && p.probs.away === eB[i].probs.away);
  console.log(`SANIDAD 2 · evaluarExp(λ sin covariables) == evaluar(V1): ${ok2 ? "SÍ ✓" : "NO ✗"}`);

  // ---- TABLA PRINCIPAL POOLED ----
  const orden = [...MODELOS].sort((a, b) => resultados[a.id].pooled.metricas.logLoss - resultados[b.id].pooled.metricas.logLoss);
  console.log("\n--- TABLA 1 · POOLED ROLLING (train+val, ~762 predicciones) · selección: LL > Brier > ECE > Acc ---");
  console.log("Modelo | Accuracy | LogLoss | Brier  | ECE    | Pred H | Pred E | Pred A | P(H)  | P(E)  | P(A)");
  for (const M of orden) {
    const { metricas: m, ext } = resultados[M.id].pooled;
    console.log(`${M.id.padEnd(6)} | ${pct(m.accuracy)} | ${m.logLoss.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.ece.toFixed(4)} | ${String(ext.cnt.home).padStart(6)} | ${String(ext.cnt.draw).padStart(6)} | ${String(ext.cnt.away).padStart(6)} | ${pct(ext.prom.home, 1)} | ${pct(ext.prom.draw, 1)} | ${pct(ext.prom.away, 1)}  ← ${M.desc}`);
  }

  const base = resultados.V1.pooled.metricas;
  console.log("\n--- TABLA 2 · Δ vs V1 (POOLED) · negativo = mejora ---");
  console.log("Modelo | Δ LogLoss | Δ Brier | Δ ECE   | Δ Accuracy");
  for (const M of orden) {
    const m = resultados[M.id].pooled.metricas;
    const d = (a, b) => (a - b >= 0 ? "+" : "") + (a - b).toFixed(4);
    console.log(`${M.id.padEnd(6)} | ${d(m.logLoss, base.logLoss).padStart(9)} | ${d(m.brier, base.brier).padStart(7)} | ${d(m.ece, base.ece).padStart(7)} | ${d(m.accuracy, base.accuracy).padStart(10)}`);
  }

  console.log("\n--- TABLA 3 · LogLoss por ventana (estabilidad) ---");
  console.log("Modelo | OFICIAL  | W1      | W2      | W3      | W4      | media rolling");
  for (const M of orden) {
    const cells = ventanas.map((w) => resultados[M.id].ventanas[w.nombre].metricas.logLoss.toFixed(4));
    const media = cells.reduce((a, b) => a + Number(b), 0) / cells.length;
    console.log(`${M.id.padEnd(6)} | ${resultados[M.id].ventanas.OFICIAL.metricas.logLoss.toFixed(4)} | ${cells.join(" | ")} | ${media.toFixed(4)}`);
  }

  console.log("\n--- TABLA 4 · Matriz de confusión y tasas por clase (POOLED) ---");
  for (const M of orden) {
    const { ext } = resultados[M.id].pooled;
    console.log(`\n  ${M.id} (${M.desc})`);
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

  console.log("\n--- TABLA 5 · Empates y visitantes (POOLED) ---");
  console.log("Modelo | P(E) prom | Empates predichos | recall E | precision E | P(A) prom | recall A | precision A");
  for (const M of orden) {
    const { ext } = resultados[M.id].pooled;
    const e = ext.por.draw, a = ext.por.away;
    console.log(
      `${M.id.padEnd(6)} | ${pct(ext.prom.draw, 1)}    | ${String(ext.cnt.draw).padStart(17)} | ${e.recall === null ? "—" : pct(e.recall, 1).padStart(8)} | ${e.precision === null ? "—" : pct(e.precision, 1).padStart(11)} | ${pct(ext.prom.away, 1)}    | ${pct(a.recall, 1).padStart(7)} | ${a.precision === null ? "—" : pct(a.precision, 1).padStart(10)}`
    );
  }

  console.log("\n--- COEFICIENTES APRENDIDOS (β=Elo, γ=forma; MLE sobre TRAIN/VAL) ---");
  for (const M of ["V2", "V3"]) {
    const coefs = Object.entries(resultados[M].coef).map(([w, c]) => `${w}: β=${c.beta}${M === "V3" ? ` γ=${c.gamma}` : ""}`);
    console.log(`  ${M}: ${coefs.join(" | ")}`);
  }

  // ---- ANÁLISIS POR BUCKETS DE DIFERENCIA ELO (solo análisis, sin tocar probs) ----
  console.log("\n--- TABLA 6 · Buckets por |ΔElo| (terciles del set de eval; SOLO ANÁLISIS) ---");
  const pooledBase = resultados.V1.items; // mismos partidos en los 3 modelos
  const diffs = pooledBase.map((it) => Math.abs(it.m.eloHome - it.m.eloAway)).sort((a, b) => a - b);
  const q1 = diffs[Math.floor(diffs.length / 3)];
  const q2 = diffs[Math.floor((2 * diffs.length) / 3)];
  const bucketDe = (m) => {
    const d = Math.abs(m.eloHome - m.eloAway);
    return d <= q1 ? "PEQUEÑA" : d <= q2 ? "MEDIA" : "GRANDE";
  };
  console.log(`  cortes |ΔElo|: pequeña ≤ ${q1.toFixed(0)}, media ≤ ${q2.toFixed(0)}, grande > ${q2.toFixed(0)}`);
  console.log("Bucket    | Modelo | n   | Accuracy | LogLoss | Brier  | P(favorito Elo) | real favorito gana | argmax = favorito");
  const bucketsInfo = {};
  for (const B of ["PEQUEÑA", "MEDIA", "GRANDE"]) {
    bucketsInfo[B] = {};
    for (const M of orden) {
      const sub = resultados[M.id].items.filter((it) => bucketDe(it.m) === B);
      const preds = sub.map((x) => x.pred);
      const mm = calcularMetricas(preds);
      let pFav = 0, favWin = 0, argFav = 0;
      for (const it of sub) {
        const fav = it.m.eloHome >= it.m.eloAway ? "home" : "away";
        pFav += it.pred.probs[fav] / 100;
        if (it.pred.real === fav) favWin += 1;
        if (argmax(it.pred.probs) === fav) argFav += 1;
      }
      const n = sub.length;
      bucketsInfo[B][M.id] = {
        n, accuracy: mm.accuracy, logLoss: mm.logLoss, brier: mm.brier,
        pFavorito: r4(pFav / n), realFavoritoGana: r4(favWin / n), argmaxFavorito: r4(argFav / n),
        ext: extendidas(preds),
      };
      console.log(`${B.padEnd(9)} | ${M.id.padEnd(6)} | ${String(n).padStart(3)} | ${pct(mm.accuracy)} | ${mm.logLoss.toFixed(4)} | ${mm.brier.toFixed(4)} | ${pct(pFav / n, 1).padStart(15)} | ${pct(favWin / n, 1).padStart(18)} | ${pct(argFav / n, 1)}`);
    }
  }

  // ---- SOLAPAMIENTO: Elo vs att/def (¿miden lo mismo?) ----
  const mV1of = entrenarExp(augTrain, "SPEC30");
  const xs = augTV.map((p) => p.eloHome - p.eloAway);
  const ys = augTV.map((p) => (mV1of.att[p.home] ?? 0) - (mV1of.def[p.away] ?? 0));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  const corr = num / Math.sqrt(dx * dy);
  console.log(`\nCorrelación(ΔElo, att_local − def_visitante) sobre TV = ${r4(corr)} → ${Math.abs(corr) > 0.7 ? "alto: se solapan; β absorberá poco" : "moderado: aportan información distinta"}`);

  // ---- SANIDAD ELO: jerarquía APRENDIDA (sin reglas manuales) ----
  const ranking = [...eloFinal.entries()].sort((a, b) => b[1] - a[1]);
  const conPartidos = new Map();
  for (const p of TV) {
    conPartidos.set(p.home, (conPartidos.get(p.home) || 0) + 1);
    conPartidos.set(p.away, (conPartidos.get(p.away) || 0) + 1);
  }
  const filtrado = ranking.filter(([e, r]) => (conPartidos.get(e) || 0) >= 5);
  console.log(`\n--- ELO FINAL APRENDIDA (K=${mejorK}, top 15 con ≥5 partidos) ---`);
  console.log(filtrado.slice(0, 15).map(([e, r]) => `  ${e.slice(0, 42).padEnd(42)} ${r.toFixed(0)}`).join("\n"));
  console.log("--- bottom 8 ---");
  console.log(filtrado.slice(-8).map(([e, r]) => `  ${e.slice(0, 42).padEnd(42)} ${r.toFixed(0)}`).join("\n"));

  // ---- GUARDAR INFORME ----
  const informe = {
    generado: new Date().toISOString(),
    nota: "TEST no evaluado. K seleccionado solo en VALIDACIÓN. Buckets = solo análisis.",
    kSeleccion: selK, kElegido: mejorK,
    sanidad: { v1OficialIgualFase1: ok1, evaluarExpIgualEvaluar: ok2 },
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length, desde: dia(w.eval[0]), hasta: dia(w.eval[w.eval.length - 1]) })),
    modelos: {},
    buckets: bucketsInfo,
    cortesBuckets: { q1: r4(q1), q2: r4(q2) },
    correlacionEloAttDef: r4(corr),
    rankingEloTop: filtrado.slice(0, 20).map(([e, r]) => ({ equipo: e, elo: Math.round(r) })),
    rankingEloBottom: filtrado.slice(-10).map(([e, r]) => ({ equipo: e, elo: Math.round(r) })),
  };
  for (const M of orden) {
    const rr = resultados[M.id];
    informe.modelos[M.id] = {
      desc: M.desc,
      oficial: rr.ventanas.OFICIAL.metricas,
      pooled: {
        accuracy: rr.pooled.metricas.accuracy, logLoss: rr.pooled.metricas.logLoss,
        brier: rr.pooled.metricas.brier, ece: rr.pooled.metricas.ece,
        pred: rr.pooled.ext.cnt, prob: rr.pooled.ext.prom,
      },
      confusion: rr.pooled.ext.cm,
      porClase: rr.pooled.ext.por,
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
  const ruta = path.join(__dirname, "informes", "fase_elo.json");
  fs.writeFileSync(ruta, JSON.stringify(informe, null, 2));
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO (reservado para la versión final elegida).");

  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
