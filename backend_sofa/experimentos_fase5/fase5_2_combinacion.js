// ---------------------------------------------------------------------------
// FASE 5.2 — COMBINACIÓN de las 1-2 candidatas preparadas en Fase 5.1.
// (autorizado: "sólo dejar preparadas 1-2 candidatas" → ahora se evalúan)
//
// REGLAS: idénticas a Fase 5.1 — TEST no cargado (SQL <= fin VAL), splits y
// ventanas oficiales día-estricto, pooled = W1-4, señales s1..s7 vs V1,
// selección LL > Brier > ECE > Accuracy. NO se toca nada protegido.
// Un combo sólo "gana" si (a) pasa las señales vs V1 y (b) BEAT AL MEJOR
// SINGLE de 5.1 (AP20N) en pooled LL — por el coste extra de 4-5 covariables.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { entrenarFeatures, lambdasFeatures } = require("../experimentos/modelo_stats_exp");
const { evaluar, calcularMetricas } = require("../services/prediccion/backtest");
const { probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");
const { cargarPartidosStats51, construir51 } = require("./features51");
const {
  CLASES, r4, pct, realDe, dia, partirTV, construirVentanas,
  extendidas, llSubconjunto,
} = require("../experimentos_fase3/comun");

const MODELO_JSON = path.join(__dirname, "..", "modelos", "prediccion_poisson.json");
const OUT = path.join(__dirname, "informes", "fase5_2_combinacion.json");

// identidades (code, w, norm) de las candidatas de 5.1
const DEFS = {
  AP20N: { code: "ap", w: 20, norm: true },
  PA10N: { code: "pa", w: 10, norm: true },
  AP10N: { code: "ap", w: 10, norm: true },
  PA20N: { code: "pa", w: 20, norm: true },
  PA5N: { code: "pa", w: 5, norm: true },
};
const VARIANTES = [
  { id: "V1", desc: "base V1 (SPEC30)", tipo: "mu", partes: [] },
  { id: "C1", desc: "V1 + AP20N + PA10N (top-2 de 5.1)", tipo: "stats", partes: ["AP20N", "PA10N"] },
  { id: "C2", desc: "V1 + las 5 candidatas de 5.1 (AP20N,PA10N,AP10N,PA20N,PA5N)", tipo: "stats", partes: ["AP20N", "PA10N", "AP10N", "PA20N", "PA5N"] },
];

const famDe = (V_) => V_.partes.map((id) => {
  const d = DEFS[id];
  const pre = `${d.code}_${d.w}_`;
  return { nombre: id, forL: pre + (d.norm ? "nforL" : "forL"), agL: pre + (d.norm ? "nagL" : "agL"),
    forV: pre + (d.norm ? "nforV" : "forV"), agV: pre + (d.norm ? "nagV" : "agV") };
});

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

const brierDraw = (preds) => {
  const sub = preds.filter((x) => x.real === "draw");
  if (!sub.length) return null;
  let s = 0;
  for (const p of sub) {
    const ph = p.probs.home / 100, pe = p.probs.draw / 100, pa = p.probs.away / 100;
    s += ph ** 2 + (pe - 1) ** 2 + pa ** 2;
  }
  return r4(s / sub.length);
};
const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 10) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx <= 0 || syy <= 0) return null;
  return r4(sxy / Math.sqrt(sxx * syy));
};

(async () => {
  console.log("=========== FASE 5.2 · COMBINACIÓN DE CANDIDATAS · solo TRAIN+VAL (TEST no cargado) ===========");
  const modeloOficial = JSON.parse(fs.readFileSync(MODELO_JSON, "utf8"));
  const valHasta = modeloOficial.backtest.split.val.hasta.slice(0, 10);

  const matches = await cargarPartidosStats51(pool, valHasta);
  const tvBase = matches.filter((p) => new Date(p.fecha).toISOString().slice(0, 10) <= valHasta);
  const { TV, nTrain, val } = partirTV(tvBase);
  console.log(`TV ${TV.length} (train ${nTrain}, val ${val.length}); TEST no cargado (SQL <= ${valHasta})`);

  const augTV = construir51(TV);
  const { oficial, ventanas } = construirVentanas(augTV, nTrain);
  console.log(`ventanas: OFICIAL fit ${oficial.fit.length}/eval ${oficial.eval.length} | W1-4 eval ${ventanas.map((w) => w.eval.length).join("/")}`);

  const res = {};
  // lrCovFactor por escala (mismo criterio documentado en Fase 5.1)
  const escalaDe = (win, fs_) => {
    const campos = fs_.flatMap((f) => [f.forL, f.agL, f.forV, f.agV]);
    const vals = [];
    for (const p of win.fit) for (const k of campos) { const v = p[k]; if (Number.isFinite(v)) vals.push(Math.abs(v)); }
    vals.sort((a, b) => a - b);
    return vals.length ? (vals[Math.floor(vals.length * 0.95)] || 1) : 1;
  };
  const entrenarYEvaluar = (V_, win) => {
    if (V_.tipo === "mu") {
      const modelo = entrenarExp(win.fit, "SPEC30");
      return { modelo, ev: evaluar(modelo, win.eval) };
    }
    const f = famDe(V_);
    const escala = escalaDe(win, f);
    const lrCovFactor = 0.05 * Math.min(1, 25 / (escala * escala));
    const modelo = entrenarFeatures(win.fit, "SPEC30", { elo: false, familias: f }, { lrCovFactor });
    for (const [k, c] of Object.entries(modelo.cov || {})) {
      if (!Number.isFinite(c.bf) || !Number.isFinite(c.ba) || Math.abs(c.bf) > 50 || Math.abs(c.ba) > 50) {
        throw new Error(`${V_.id}/${k}: coeficientes no finitos bf=${c.bf} ba=${c.ba}`);
      }
    }
    return { modelo, ev: evaluarFeatures(modelo, win.eval), escala, lrCovFactor };
  };

  for (const V_ of VARIANTES) {
    res[V_.id] = { desc: V_.desc, ventanas: {}, coef: {} };
    for (const win of [oficial, ...ventanas]) {
      const { modelo, ev, escala, lrCovFactor } = entrenarYEvaluar(V_, win);
      const items = win.eval.map((p, i) => ({ m: p, pred: ev.predicciones[i] }));
      const preds = ev.predicciones;
      res[V_.id].ventanas[win.nombre] = {
        metricas: ev.metricas, ext: extendidas(preds),
        llEmp: llSubconjunto(preds, "draw"), brierEmp: brierDraw(preds), items,
      };
      if (V_.tipo !== "mu") res[V_.id].coef[win.nombre] = { ...modelo.cov, escala: r4(escala), lrCovFactor };
    }
    const poolItems = ventanas.flatMap((w) => res[V_.id].ventanas[w.nombre].items);
    const poolPreds = poolItems.map((x) => x.pred);
    res[V_.id].items = poolItems;
    res[V_.id].pooled = {
      metricas: calcularMetricas(poolPreds), ext: extendidas(poolPreds),
      llEmp: llSubconjunto(poolPreds, "draw"), brierEmp: brierDraw(poolPreds),
    };
    console.log(`  ✓ ${V_.id} (${V_.desc})`);
  }

  // ---------------- SANIDADES ----------------
  const f33 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "experimentos_fase3", "informes", "fase3_3_experimentos.json"), "utf8"));
  const ok1 = (() => {
    const b = modeloOficial.backtest.val;
    const m = res.V1.ventanas.OFICIAL.metricas;
    return m.accuracy === b.accuracy && m.logLoss === b.logLoss && m.brier === b.brier;
  })();
  const v1p = res.V1.pooled.metricas, v1pPrev = f33.modelos.V1.pooled;
  const ok2 = r4(v1p.logLoss) === v1pPrev.logLoss && r4(v1p.brier) === v1pPrev.brier
    && r4(v1p.ece) === v1pPrev.ece && r4(v1p.accuracy) === v1pPrev.accuracy;
  const ok3 = JSON.stringify(f33.ventanas.map((v) => [v.fit, v.eval, v.desde, v.hasta]))
    === JSON.stringify(ventanas.map((w) => [w.fit.length, w.eval.length,
      new Date(w.eval[0].fecha).toISOString().slice(0, 10),
      new Date(w.eval[w.eval.length - 1].fecha).toISOString().slice(0, 10)]));
  console.log(`\nSANIDAD 1 · V1/OFICIAL == JSON oficial: ${ok1 ? "SÍ ✓" : "NO ✗"}`);
  console.log(`SANIDAD 2 · V1 pooled == fase3_3 (LL ${v1pPrev.logLoss}): ${ok2 ? "SÍ ✓" : `NO ✗ (${r4(v1p.logLoss)})`}`);
  console.log(`SANIDAD 3 · ventanas idénticas a fase3_3: ${ok3 ? "SÍ ✓" : "NO ✗"}`);
  if (!ok1 || !ok2 || !ok3) throw new Error("Sanidad fallida — detener.");

  // ---------------- eventos de piso (diagnóstico) ----------------
  const UMBRAL_PISO = 20;
  const llDePred = (pr) => -Math.log(Math.max(1e-15, (pr.probs[pr.real] ?? 1e-15) / 100));
  const pisoDe = (items, vll) => {
    const ll = items.map((x) => llDePred(x.pred));
    const eventos = [];
    items.forEach((x, i) => {
      if (ll[i] > UMBRAL_PISO) {
        eventos.push({ id: x.m.id, fecha: dia(x.m), liga: x.m.liga, partido: `${x.m.home} v ${x.m.away}`,
          marcador: `${x.m.goalsH}-${x.m.goalsA}`, llModelo: r4(ll[i]), llV1: r4(vll[i]) });
      }
    });
    const esPiso = ll.map((v, i) => v > UMBRAL_PISO || vll[i] > UMBRAL_PISO);
    const mask = esPiso.map((x) => !x);
    const media = (arr) => { let s = 0, c = 0; arr.forEach((v, i) => { if (mask[i]) { s += v; c++; } }); return c ? s / c : null; };
    const llSin = media(ll), llV1Sin = media(vll);
    return { n: esPiso.filter(Boolean).length, eventos,
      logLoss_sinPiso: llSin === null ? null : r4(llSin),
      logLossV1_sinPiso: llV1Sin === null ? null : r4(llV1Sin),
      deltaSinPiso: llSin === null || llV1Sin === null ? null : r4(llSin - llV1Sin) };
  };
  for (const V_ of VARIANTES) {
    const rr = res[V_.id];
    rr.piso = { OFICIAL: pisoDe(rr.ventanas.OFICIAL.items, res.V1.ventanas.OFICIAL.items.map((x) => llDePred(x.pred))) };
    for (const w of ventanas) {
      rr.piso[w.nombre] = pisoDe(rr.ventanas[w.nombre].items, res.V1.ventanas[w.nombre].items.map((x) => llDePred(x.pred)));
    }
    rr.piso.pooled = pisoDe(rr.items, res.V1.items.map((x) => llDePred(x.pred)));
  }
  const pisoPooledTotal = VARIANTES.reduce((a, V_) => a + res[V_.id].piso.pooled.n, 0);
  console.log(`PISO · eventos pooled W1-4: ${pisoPooledTotal}`);
  for (const V_ of VARIANTES) {
    if (res[V_.id].piso.OFICIAL.n > 0) console.log(`  ${V_.id}: OFICIAL con ${res[V_.id].piso.OFICIAL.n} evento(s) → sin-piso Δ ${res[V_.id].piso.OFICIAL.deltaSinPiso}`);
  }

  // ---------------- señales vs V1 + batalla vs mejor single (AP20N) ----------------
  const f51 = JSON.parse(fs.readFileSync(path.join(__dirname, "informes", "fase5_1_valor_incremental.json"), "utf8"));
  const mejorSingle = f51.candidatas_a_combinacion[0]; // AP20N (orden de 5.1)
  const ms = f51.experimentos[mejorSingle].pooled;
  const base = res.V1.pooled.metricas;
  const baseEmp = { ll: res.V1.pooled.llEmp, brier: res.V1.pooled.brierEmp };
  const v1Recall = CLASES.map((c) => res.V1.pooled.ext.por[c].recall);

  const evaluarSenales = (id) => {
    const rr = res[id], m = rr.pooled.metricas;
    const dLL = r4(m.logLoss - base.logLoss);
    const dBr = r4(m.brier - base.brier);
    const dEc = r4(m.ece - base.ece);
    const dLLE = r4(rr.pooled.llEmp - baseEmp.ll);
    const dBrE = r4(rr.pooled.brierEmp - baseEmp.brier);
    const cells = ventanas.map((w) => rr.ventanas[w.nombre].metricas.logLoss);
    const v1cells = ventanas.map((w) => res.V1.ventanas[w.nombre].metricas.logLoss);
    const gana = cells.filter((c, i) => c < v1cells[i]).length;
    const recall = CLASES.map((c) => rr.pooled.ext.por[c].recall);
    const peorRecall = Math.min(...CLASES.map((c, i) => recall[i] - v1Recall[i]));
    const s = {
      s1_deltaLL: dLL < 0, s2_deltaLLEmpate: dLLE < 0, s3_deltaBrier: dBr <= 0,
      s4_deltaECE: dEc <= 0.0005, s5_deltaBrierEmpate: dBrE <= 0,
      s6_ventanasLL: gana >= 3, s7_recalls: peorRecall >= -0.02,
    };
    const total = Object.values(s).filter(Boolean).length;
    const candidato = s.s1_deltaLL && s.s3_deltaBrier && s.s6_ventanasLL && total >= 5;
    // batalla vs mejor single (pooled LL de 5.1) + por ventana
    const dVsSingle = r4(m.logLoss - ms.logLoss);
    const cellsSingle = ["W1", "W2", "W3", "W4"].map((k) => f51.experimentos[mejorSingle].porVentana[k].logLoss);
    const ganaSingle = cells.filter((c, i) => c < cellsSingle[i]).length;
    return { deltas: { logLoss: dLL, brier: dBr, ece: dEc, llEmpate: dLLE, brierEmpate: dBrE,
        accuracy: r4(m.accuracy - base.accuracy) },
      senales: s, totalSenales: total, ventanasGanaLL: gana, peorDeltaRecall: r4(peorRecall),
      candidato, senalDebil: s.s1_deltaLL && (dBr > 0.002 || dEc > 0.01 || gana < 3),
      vsMejorSingle: { single: mejorSingle, deltaLL: dVsSingle, ventanasGanaSingle: ganaSingle,
        superaSingle: dVsSingle < 0 },
      piso: { OFICIAL: rr.piso.OFICIAL.n, pooled: rr.piso.pooled.n,
        deltaOFICIAL_sinPiso: rr.piso.OFICIAL.deltaSinPiso } };
  };
  for (const V_ of VARIANTES) if (V_.id !== "V1") res[V_.id].analisis = evaluarSenales(V_.id);

  // redundancia entre las dos familias de C1 (¿AP20N y PA10N miden lo mismo?)
  const redundanciaC1 = (() => {
    const [a, b] = VARIANTES.find((v) => v.id === "C1").partes;
    const fa = famDe({ partes: [a] })[0], fb = famDe({ partes: [b] })[0];
    const xs = [], ys = [];
    for (const p of augTV) { xs.push(p[fa.forL]); ys.push(p[fb.forL]); }
    return { par: `${a} vs ${b}`, r_feature: pearson(xs, ys) };
  })();

  // ---------------- tablas ----------------
  const base2 = res.V1.pooled.metricas;
  console.log("\n--- TABLA 1 · POOLED (W1-4, 762) ---");
  console.log("Exp  | Accuracy | LogLoss | Brier  | ECE    | LLemp  | señales | ΔvsV1  | ΔvsAP20N | piso");
  for (const id of ["C1", "C2", "V1"]) {
    const rr = res[id], m = rr.pooled.metricas;
    const sen = id === "V1" ? "-" : `${rr.analisis.totalSenales}/7`;
    const d1 = id === "V1" ? "-" : String(rr.analisis.deltas.logLoss);
    const d2 = id === "V1" ? "-" : String(rr.analisis.vsMejorSingle.deltaLL);
    console.log(`${id.padEnd(4)} | ${pct(m.accuracy)} | ${m.logLoss.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.ece.toFixed(4)} | ${String(rr.pooled.llEmp).padStart(6)} | ${sen} | ${d1.padStart(6)} | ${d2.padStart(8)} | ${rr.piso.pooled.n}`);
  }
  console.log(`(mejor single ${mejorSingle}: LL ${ms.logLoss}, Brier ${ms.brier}, ECE ${ms.ece}, acc ${ms.accuracy})`);

  console.log("\n--- TABLA 2 · señales y batalla ---");
  for (const id of ["C1", "C2"]) {
    const a = res[id].analisis;
    console.log(`${id}: ${JSON.stringify(a.senales)}`);
    console.log(`    total=${a.totalSenales}/7 candidato=${a.candidato} ventanas=${a.ventanasGanaLL}/4 | vs ${a.vsMejorSingle.single}: ΔLL=${a.vsMejorSingle.deltaLL} gana=${a.vsMejorSingle.ventanasGanaSingle}/4 supera=${a.vsMejorSingle.superaSingle}`);
  }

  console.log("\n--- TABLA 3 · LogLoss por ventana ---");
  console.log("Exp  | OFICIAL | sin-piso | W1      | W2      | W3      | W4      | ganaV1");
  for (const id of ["C1", "C2", "V1"]) {
    const cells = ventanas.map((w) => res[id].ventanas[w.nombre].metricas.logLoss);
    const g = id === "V1" ? "-" : `${res[id].analisis.ventanasGanaLL}/4`;
    const po = res[id].piso.OFICIAL;
    const sin = po.n > 0 ? `${po.logLoss_sinPiso}*` : res[id].ventanas.OFICIAL.metricas.logLoss.toFixed(4);
    console.log(`${id.padEnd(4)} | ${res[id].ventanas.OFICIAL.metricas.logLoss.toFixed(4)} | ${String(sin).padStart(8)} | ${cells.map((c) => c.toFixed(4)).join(" | ")} | ${g}`);
  }

  // ---------------- veredicto ----------------
  const veredicto = {};
  for (const id of ["C1", "C2"]) {
    const a = res[id].analisis;
    veredicto[id] = a.candidato && a.vsMejorSingle.superaSingle
      ? "GANA_AL_MEJOR_SINGLE" : a.candidato
      ? "PASA_SEÑALES_PERO_NO_SUPERA_AL_SINGLE" : "NO_MEJORA";
  }
  const ganador = ["C1", "C2"].filter((id) => veredicto[id] === "GANA_AL_MEJOR_SINGLE")
    .sort((a, b) => res[a].pooled.metricas.logLoss - res[b].pooled.metricas.logLoss)[0] || null;
  console.log(`\nVEREDICTO: C1=${veredicto.C1} | C2=${veredicto.C2}`);
  console.log(ganador ? `GANADOR: ${ganador} (promover a siguiente fase)` : `NINGÚN COMBO SUPERA A ${mejorSingle} — mantener el single como mejor candidata`);

  // ---------------- INFORME ----------------
  const informe = {
    generado: new Date().toISOString(),
    fase: "5.2 — Combinación de las candidatas de Fase 5.1",
    reglas: [
      "TEST NO cargado. Splits/ventanas oficiales idénticos. pooled = W1-4. Señales s1..s7 idénticas a 5.1 vs V1.",
      "Combo gana SÓLO si pasa señales vs V1 Y supera en pooled LL al mejor single de 5.1 (AP20N).",
      "Máximo 2 combos (C1 = top-2, C2 = las 5 candidatas) — sin combinaciones masivas.",
      "lrCovFactor = 0.05·min(1,25/escala²) por escala p95 de las familias unidas (reparametrización de optimización, mismo MLE).",
      "Eventos de piso (ll>20) detectados como diagnóstico; no alteran la selección.",
    ],
    sanidad: { v1OficialIgualJson: ok1, v1PooledIgualFase33: ok2, ventanasIgualesFase33: ok3 },
    baseline_V1: { oficial: res.V1.ventanas.OFICIAL.metricas,
      pooled: { accuracy: r4(base2.accuracy), logLoss: r4(base2.logLoss), brier: base2.brier, ece: base2.ece } },
    mejorSingle_5_1: { id: mejorSingle, pooled: ms },
    combos: {},
    redundancia_entre_familias_C1: redundanciaC1,
    veredicto, ganador,
    descartados: ["C1", "C2"].filter((id) => veredicto[id] !== "GANA_AL_MEJOR_SINGLE"),
    diagnostico_piso: { umbral: UMBRAL_PISO, eventosPooled: pisoPooledTotal },
    verificacion: "pendiente post-ejecución",
  };
  for (const id of ["C1", "C2", "V1"]) {
    const rr = res[id];
    informe.combos[id] = {
      desc: rr.desc,
      pooled: { accuracy: r4(rr.pooled.metricas.accuracy), logLoss: r4(rr.pooled.metricas.logLoss),
        brier: rr.pooled.metricas.brier, ece: rr.pooled.metricas.ece,
        llEmpate: rr.pooled.llEmp, brierEmpate: rr.pooled.brierEmp,
        recall: Object.fromEntries(CLASES.map((c) => [c, r4(rr.pooled.ext.por[c].recall)])) },
      porVentana: Object.fromEntries(Object.entries(rr.ventanas).map(([k, x]) => [k, {
        n: x.items.length, logLoss: r4(x.metricas.logLoss), brier: x.metricas.brier, ece: x.metricas.ece,
        deltaLLvsV1: r4(x.metricas.logLoss - res.V1.ventanas[k].metricas.logLoss) }])),
      piso: rr.piso,
      ...(id !== "V1" ? { deltaVsV1: rr.analisis.deltas, senales: rr.analisis.senales,
        totalSenales: rr.analisis.totalSenales, ventanasGanaLL: rr.analisis.ventanasGanaLL,
        candidato: rr.analisis.candidato, vsMejorSingle: rr.analisis.vsMejorSingle,
        coeficientes: rr.coef } : {}),
    };
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(informe, null, 2), "utf8");
  console.log(`\nInforme: ${OUT}`);
  console.log("TEST: NO EVALUADO. Fase 6: NO ejecutada (a la espera de aprobación explícita).");
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
