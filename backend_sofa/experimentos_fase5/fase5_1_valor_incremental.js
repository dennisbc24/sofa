// ---------------------------------------------------------------------------
// FASE 5.1 — VALOR INCREMENTAL de variables Tier A sobre V1.
//
// REGLAS (obligatorias):
//  - TEST NO se carga: el SQL filtra fecha <= fin de VAL (2026-06-18).
//  - Mismo protocolo de fases anteriores: splits oficiales del JSON, ventanas
//    rolling día-estricto (OFICIAL + W1-4), pooled = W1-4, selección
//    LL > Brier > ECE > Accuracy + estabilidad temporal.
//  - V1_BETA/producción intactos; prediccion_poisson.json SÓLO de lectura.
//  - Sin DDL/DML (sólo SELECT), sin reglas por liga, sin selección por
//    correlación: el criterio final es valor incremental fuera de muestra.
//  - EXPERIMENTOS INDIVIDUALES (sin combinaciones masivas).
//  - Modelo 2T: SÓLO se conservan candidatas (sin entrenar).
//
// Variantes: V1 + 1 stat cruda (MA5; MA10/20 sólo donde Fase 5 justificó por
// ICC) y, para eta²>=0.05 (Touches, Accurate passes, Passes), la versión
// normalizada por referencia de liga frente a la sin normalizar.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { entrenarFeatures, lambdasFeatures } = require("../experimentos/modelo_stats_exp");
const { evaluar, calcularMetricas } = require("../services/prediccion/backtest");
const { probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");
const { cargarPartidosStats51, construir51, STATS } = require("./features51");
const {
  CLASES, r4, pct, realDe, dia, partirTV, construirVentanas,
  extendidas, llSubconjunto,
} = require("../experimentos_fase3/comun");

const MODELO_JSON = path.join(__dirname, "..", "modelos", "prediccion_poisson.json");
const OUT = path.join(__dirname, "informes", "fase5_1_valor_incremental.json");

// id → { code, w, norm }
const V = (id, desc, code, w, norm) => ({ id, desc, tipo: "stats", code, w, norm });
const VARIANTES = [
  { id: "V1", desc: "base V1 (SPEC30)", tipo: "mu" },
  V("TP5", "V1 + Touches in opp box MA5", "tp", 5, false),
  V("TP10", "V1 + Touches MA10", "tp", 10, false),
  V("TP5N", "V1 + Touches MA5 norm liga (eta²=.065)", "tp", 5, true),
  V("TP10N", "V1 + Touches MA10 norm liga", "tp", 10, true),
  V("F3P5", "V1 + Final third phase MA5", "f3p", 5, false),
  V("F3P10", "V1 + Final third phase MA10", "f3p", 10, false),
  V("F3E5", "V1 + Final third entries MA5", "f3e", 5, false),
  V("SIB5", "V1 + Shots inside box MA5", "sib", 5, false),
  V("AP5", "V1 + Accurate passes MA5", "ap", 5, false),
  V("AP10", "V1 + Accurate passes MA10", "ap", 10, false),
  V("AP20", "V1 + Accurate passes MA20", "ap", 20, false),
  V("AP5N", "V1 + Accurate passes MA5 norm (eta²=.091)", "ap", 5, true),
  V("AP10N", "V1 + Accurate passes MA10 norm", "ap", 10, true),
  V("AP20N", "V1 + Accurate passes MA20 norm", "ap", 20, true),
  V("PA5", "V1 + Passes MA5", "pa", 5, false),
  V("PA10", "V1 + Passes MA10", "pa", 10, false),
  V("PA20", "V1 + Passes MA20", "pa", 20, false),
  V("PA5N", "V1 + Passes MA5 norm (eta²=.090)", "pa", 5, true),
  V("PA10N", "V1 + Passes MA10 norm", "pa", 10, true),
  V("PA20N", "V1 + Passes MA20 norm", "pa", 20, true),
];

function famDe(V) {
  const pre = `${V.code}_${V.w}_`;
  return [{
    nombre: V.id,
    forL: pre + (V.norm ? "nforL" : "forL"),
    agL: pre + (V.norm ? "nagL" : "agL"),
    forV: pre + (V.norm ? "nforV" : "forV"),
    agV: pre + (V.norm ? "nagV" : "agV"),
  }];
}

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
  console.log("=========== FASE 5.1 · VALOR INCREMENTAL · solo TRAIN+VAL (TEST no cargado) ===========");
  const modeloOficial = JSON.parse(fs.readFileSync(MODELO_JSON, "utf8"));
  const valHasta = modeloOficial.backtest.split.val.hasta.slice(0, 10);

  const matches = await cargarPartidosStats51(pool, valHasta);
  const tvBase = matches.filter((p) => new Date(p.fecha).toISOString().slice(0, 10) <= valHasta);
  const { TV, nTrain, train, val } = partirTV(tvBase);
  console.log(`TV ${TV.length} (train ${nTrain}, val ${val.length}); TEST no cargado (SQL <= ${valHasta})`);

  const augTV = construir51(TV);
  const { oficial, ventanas } = construirVentanas(augTV, nTrain);
  console.log(`ventanas: OFICIAL fit ${oficial.fit.length}/eval ${oficial.eval.length} | W1-4 eval ${ventanas.map((w) => w.eval.length).join("/")}`);

  // ---------------- ejecución ----------------
  const res = {};
  // lrCovFactor por escala: el trainer calibra lrCovFactor=0.05 para features
  // de escala ~5 (modelo_stats_exp.js:21-24). Features crudas de gran escala
  // (toques ~25, passes ~500) divergen por realimentación exponencial de λ.
  // Mantenemos el paso efectivo equivalente en log λ: lrC = 0.05·min(1, 25/escala²)
  // (escala = p95(|x|) de la familia en el fit). Sólo reparametriza la ruta de
  // optimización: objetivo, l2Cov y óptimo MLE idénticos.
  const escalaDe = (win, f) => {
    const vals = [];
    for (const p of win.fit) for (const k of [f.forL, f.agL, f.forV, f.agV]) {
      const v = p[k];
      if (Number.isFinite(v)) vals.push(Math.abs(v));
    }
    vals.sort((a, b) => a - b);
    return vals.length ? (vals[Math.floor(vals.length * 0.95)] || 1) : 1;
  };
  const entrenarYEvaluar = (V_, win) => {
    if (V_.tipo === "mu") {
      const modelo = entrenarExp(win.fit, "SPEC30");
      return { modelo, ev: evaluar(modelo, win.eval) };
    }
    const f = famDe(V_)[0];
    const escala = escalaDe(win, f);
    const lrCovFactor = 0.05 * Math.min(1, 25 / (escala * escala));
    const modelo = entrenarFeatures(win.fit, "SPEC30", { elo: false, familias: [f] }, { lrCovFactor });
    for (const [, c] of Object.entries(modelo.cov || {})) {
      if (!Number.isFinite(c.bf) || !Number.isFinite(c.ba) || Math.abs(c.bf) > 50 || Math.abs(c.ba) > 50) {
        throw new Error(`${V_.id}: coeficientes no finitos bf=${c.bf} ba=${c.ba}`);
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
        metricas: ev.metricas,
        ext: extendidas(preds),
        llEmp: llSubconjunto(preds, "draw"),
        brierEmp: brierDraw(preds),
        items,
      };
      if (V_.tipo !== "mu") res[V_.id].coef[win.nombre] = { ...modelo.cov, escala: r4(escala), lrCovFactor };
    }
    const poolItems = ventanas.flatMap((w) => res[V_.id].ventanas[w.nombre].items);
    const poolPreds = poolItems.map((x) => x.pred);
    res[V_.id].items = poolItems;
    res[V_.id].pooled = {
      metricas: calcularMetricas(poolPreds),
      ext: extendidas(poolPreds),
      llEmp: llSubconjunto(poolPreds, "draw"),
      brierEmp: brierDraw(poolPreds),
    };
    console.log(`  ✓ ${V_.id} (${V_.desc})`);
  }

  // ---------------- SANIDADES (protocolo idéntico a fases previas) ----------------
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

  // ---------------- EVENTOS DE PISO (diagnóstico; no alteran la selección) ----------------
  // ll por partido = -log(p_real). El piso numérico de probsDesdeLambdas es 1e-15
  // (ll = 34.54). Un solo partido puede contaminar una ventana: p.ej. V1 ya da
  // λ_home=10.55 en Málaga v Almería (0-0, "La Liga Dos 2025" AUSENTE en ligas →
  // fallback a μ global con att/def identificados en otra liga); una perturbación
  // de ±0.5% de λ hunde p_draw bajo el piso y añade ~+28 LL a la ventana.
  const UMBRAL_PISO = 20; // ll > 20 ⇒ p_real < 2e-9: sólo alcanzable en el piso
  const llDePred = (pr) => -Math.log(Math.max(1e-15, (pr.probs[pr.real] ?? 1e-15) / 100));
  const llV1PorItem = (items) => items.map((x) => llDePred(x.pred));
  const pisoDe = (items, vll) => {
    const ll = items.map((x) => llDePred(x.pred));
    const eventos = [];
    items.forEach((x, i) => {
      if (ll[i] > UMBRAL_PISO) {
        eventos.push({ id: x.m.id, fecha: dia(x.m), liga: x.m.liga, partido: `${x.m.home} v ${x.m.away}`,
          marcador: x.m.marcador ?? `${x.m.goalsH}-${x.m.goalsA}`, llModelo: r4(ll[i]), llV1: r4(vll[i]) });
      }
    });
    const esPiso = ll.map((v, i) => v > UMBRAL_PISO || vll[i] > UMBRAL_PISO);
    const mask = esPiso.map((x) => !x);
    const n = esPiso.filter(Boolean).length;
    const media = (arr) => {
      let s = 0, c = 0;
      arr.forEach((v, i) => { if (mask[i]) { s += v; c++; } });
      return c ? s / c : null;
    };
    const llSin = media(ll), llV1Sin = media(vll);
    return { n, eventos, logLoss_sinPiso: llSin === null ? null : r4(llSin),
      logLossV1_sinPiso: llV1Sin === null ? null : r4(llV1Sin),
      deltaSinPiso: llSin === null || llV1Sin === null ? null : r4(llSin - llV1Sin) };
  };
  for (const V_ of VARIANTES) {
    const rr = res[V_.id];
    const v1llOf = llV1PorItem(res.V1.ventanas.OFICIAL.items);
    rr.piso = { OFICIAL: pisoDe(rr.ventanas.OFICIAL.items, v1llOf) };
    for (const w of ventanas) {
      const v1llW = llV1PorItem(res.V1.ventanas[w.nombre].items);
      rr.piso[w.nombre] = pisoDe(rr.ventanas[w.nombre].items, v1llW);
    }
    const v1llP = llV1PorItem(res.V1.items);
    rr.piso.pooled = pisoDe(rr.items, v1llP);
  }
  const pisoPooledTotal = VARIANTES.reduce((a, V_) => a + res[V_.id].piso.pooled.n, 0);
  const pisoOficialAfectados = VARIANTES.filter((V_) => res[V_.id].piso.OFICIAL.n > 0).map((V_) => V_.id);
  console.log(`\nPISO · eventos pooled W1-4: ${pisoPooledTotal} | con eventos en OFICIAL: ${pisoOficialAfectados.join(", ") || "ninguno"}`);
  for (const id of pisoOficialAfectados) {
    const p = res[id].piso.OFICIAL;
    console.log(`  ${id}: OFICIAL sin-piso LL ${p.logLoss_sinPiso} (Δvs V1 sin-piso ${p.deltaSinPiso}) — ${p.eventos.map((e) => e.partido).join("; ")}`);
  }

  const base = res.V1.pooled.metricas;
  const baseEmp = { ll: res.V1.pooled.llEmp, brier: res.V1.pooled.brierEmp };

  // ---------------- deltas, señales, consistencia ----------------
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
      s1_deltaLL: dLL < 0,
      s2_deltaLLEmpate: dLLE < 0,
      s3_deltaBrier: dBr <= 0,
      s4_deltaECE: dEc <= 0.0005,
      s5_deltaBrierEmpate: dBrE <= 0,
      s6_ventanasLL: gana >= 3,
      s7_recalls: peorRecall >= -0.02,
    };
    const total = Object.values(s).filter(Boolean).length;
    const candidato = s.s1_deltaLL && s.s3_deltaBrier && s.s6_ventanasLL && total >= 5;
    const senalDebil = s.s1_deltaLL && (dBr > 0.002 || dEc > 0.01 || gana < 3);
    return { deltas: { logLoss: dLL, brier: dBr, ece: dEc, llEmpate: dLLE, brierEmpate: dBrE,
      accuracy: r4(m.accuracy - base.accuracy) },
      senales: s, totalSenales: total, ventanasGanaLL: gana, peorDeltaRecall: r4(peorRecall),
      candidato, senalDebil,
      piso: { OFICIAL: rr.piso.OFICIAL.n, pooled: rr.piso.pooled.n,
        deltaOFICIAL_sinPiso: rr.piso.OFICIAL.deltaSinPiso } };
  };
  for (const V_ of VARIANTES) if (V_.id !== "V1") res[V_.id].analisis = evaluarSenales(V_.id);

  // ---------------- redundancia con att/def/mu de V1 ----------------
  const pV1 = modeloOficial.parametros;
  const redundancia = {};
  const paresUsados = [...new Set(VARIANTES.filter((x) => x.tipo === "stats").map((x) => `${x.code}|${x.w}`))];
  for (const par of paresUsados) {
    const [code, w] = par.split("|");
    const wn = Number(w);
    const ownSum = new Map(), ownN = new Map();   // media propia por equipo (raw, con historia)
    const dx = [], dyAtt = [], dyDef = [];
    const ligaSum = new Map(), ligaN = new Map();
    for (const p of augTV) {
      const fh = p[`${code}_${wn}_forL`], fa = p[`${code}_${wn}_forV`];
      const nh = p[`${code}_${wn}_nF`], na = p[`${code}_${wn}_nFV`];
      if (nh > 0) { ownSum.set(p.home, (ownSum.get(p.home) || 0) + fh); ownN.set(p.home, (ownN.get(p.home) || 0) + 1);
        ligaSum.set(p.liga, (ligaSum.get(p.liga) || 0) + fh); ligaN.set(p.liga, (ligaN.get(p.liga) || 0) + 1); }
      if (na > 0) { ownSum.set(p.away, (ownSum.get(p.away) || 0) + fa); ownN.set(p.away, (ownN.get(p.away) || 0) + 1);
        ligaSum.set(p.liga, (ligaSum.get(p.liga) || 0) + fa); ligaN.set(p.liga, (ligaN.get(p.liga) || 0) + 1); }
      if (nh > 0 && na > 0) {
        const attH = pV1.att[p.home] ?? 0, attA = pV1.att[p.away] ?? 0;
        dx.push(fh - fa); dyAtt.push(attH - attA);
        const defH = pV1.def[p.home] ?? 0, defA = pV1.def[p.away] ?? 0;
        dyDef.push(defA - defH); // Δ(qué recibe el rival − ...) alineado con fuerza ofensiva
      }
    }
    const eqs = [...ownN.entries()].filter(([, n]) => n >= 5).map(([eq]) => eq)
      .filter((eq) => pV1.att[eq] !== undefined);
    const feat = eqs.map((eq) => ownSum.get(eq) / ownN.get(eq));
    const atts = eqs.map((eq) => pV1.att[eq]);
    const defs = eqs.map((eq) => pV1.def[eq]);
    const ligasConParam = Object.keys(pV1.ligas).filter((l) => ligaN.get(l) >= 10);
    const lFeat = ligasConParam.map((l) => ligaSum.get(l) / ligaN.get(l));
    const lMu = ligasConParam.map((l) => pV1.ligas[l].muHome);
    const interp = (r) => r === null ? "n/d" : Math.abs(r) >= 0.6 ? "REDUNDANTE ALTA (mide la fuerza que V1 ya conoce)"
      : Math.abs(r) >= 0.35 ? "REDUNDANTE PARCIAL" : "INFORMACIÓN RELATIVAMENTE NUEVA";
    redundancia[par] = {
      nEquipos: eqs.length,
      r_feature_vs_att: pearson(feat, atts),
      r_feature_vs_def: pearson(feat, defs),
      r_deltaFeature_vs_deltaAtt: pearson(dx, dyAtt),
      nLigas: ligasConParam.length,
      r_ligaFeature_vs_muHome: pearson(lFeat, lMu),
      interpretacion_delta: interp(pearson(dx, dyAtt)),
    };
  }

  // ---------------- consistencia por liga (pooled, n>=30) ----------------
  const ligaIdx = new Map();
  res.V1.items.forEach((x, i) => {
    if (!ligaIdx.has(x.m.liga)) ligaIdx.set(x.m.liga, []);
    ligaIdx.get(x.m.liga).push(i);
  });
  for (const V_ of VARIANTES) {
    if (V_.id === "V1") continue;
    const filas = [];
    let gana = 0, pierde = 0;
    for (const [liga, idxs] of ligaIdx) {
      if (idxs.length < 30) continue;
      const llV1 = calcularMetricas(idxs.map((i) => res.V1.items[i].pred)).logLoss;
      const llE = calcularMetricas(idxs.map((i) => res[V_.id].items[i].pred)).logLoss;
      const d = r4(llE - llV1);
      if (d < 0) gana++; else pierde++;
      filas.push({ liga, n: idxs.length, llV1: r4(llV1), deltaLL: d });
    }
    res[V_.id].porLiga = { gana, pierde, filas };
  }

  // ---------------- ranking (LL > Brier > ECE > Acc) ----------------
  const orden = VARIANTES.map((x) => x.id).sort((a, b) =>
    res[a].pooled.metricas.logLoss - res[b].pooled.metricas.logLoss ||
    res[b].pooled.metricas.brier - res[a].pooled.metricas.brier ||
    res[b].pooled.metricas.ece - res[a].pooled.metricas.ece ||
    res[b].pooled.metricas.accuracy - res[a].pooled.metricas.accuracy);

  console.log("\n--- TABLA 1 · POOLED (W1-4, ~762) · LL > Brier > ECE > Acc ---");
  console.log("Exp     | Accuracy | LogLoss | Brier  | ECE    | LLemp  | BBrEmp | rH    rE    rA   | señales | piso");
  for (const id of orden) {
    const rr = res[id], m = rr.pooled.metricas, e = rr.pooled.ext;
    const sen = id === "V1" ? "-" : `${rr.analisis.totalSenales}/7`;
    console.log(`${id.padEnd(7)} | ${pct(m.accuracy)} | ${m.logLoss.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.ece.toFixed(4)} | ${String(rr.pooled.llEmp).padStart(6)} | ${String(rr.pooled.brierEmp).padStart(6)} | ${e.por.home.recall.toFixed(3)} ${e.por.draw.recall.toFixed(3)} ${e.por.away.recall.toFixed(3)} | ${sen} | ${rr.piso.pooled.n}`);
  }

  console.log("\n--- TABLA 2 · Δ vs V1 (pooled) · negativo = mejora ---");
  console.log("Exp     | ΔLL     | ΔBrier  | ΔECE    | ΔAcc    | ΔLLemp  | ΔBBrEmp | ventanas | candidato");
  for (const id of orden) {
    if (id === "V1") continue;
    const a = res[id].analisis, d = a.deltas;
    console.log(`${id.padEnd(7)} | ${String(d.logLoss).padStart(7)} | ${String(d.brier).padStart(7)} | ${String(d.ece).padStart(7)} | ${String(d.accuracy).padStart(7)} | ${String(d.llEmpate).padStart(7)} | ${String(d.brierEmpate).padStart(7)} | ${a.ventanasGanaLL}/4     | ${a.candidato ? "SÍ" : "no"}${a.senalDebil ? " (débil)" : ""}`);
  }

  console.log("\n--- TABLA 3 · LogLoss por ventana (OFICIAL sin-piso = diagnóstico) ---");
  console.log("Exp     | OFICIAL | sin-piso | W1      | W2      | W3      | W4      | gana");
  for (const id of orden) {
    const cells = ventanas.map((w) => res[id].ventanas[w.nombre].metricas.logLoss);
    const g = id === "V1" ? "-" : `${res[id].analisis.ventanasGanaLL}/4`;
    const po = res[id].piso.OFICIAL;
    const sin = po.n > 0 ? `${po.logLoss_sinPiso}*` : res[id].ventanas.OFICIAL.metricas.logLoss.toFixed(4);
    console.log(`${id.padEnd(7)} | ${res[id].ventanas.OFICIAL.metricas.logLoss.toFixed(4)} | ${String(sin).padStart(8)} | ${cells.map((c) => c.toFixed(4)).join(" | ")} | ${g}`);
  }
  console.log("  (* = OFICIAL con eventos de piso; ver TABLA 5 — fuera de la selección)");

  console.log("\n--- TABLA 5 · Eventos de piso (ll>20 ⇒ p_real<2e-9) ---");
  let pisoImpreso = 0;
  for (const id of orden) {
    for (const k of ["OFICIAL", ...ventanas.map((w) => w.nombre), "pooled"]) {
      for (const e of res[id].piso[k].eventos) {
        console.log(`${id.padEnd(7)} ${k.padEnd(8)} ${e.fecha} ${e.partido} (${e.marcador}) ll=${e.llModelo} (V1=${e.llV1})`);
        pisoImpreso++;
      }
    }
  }
  if (!pisoImpreso) console.log("  (ninguno)");

  console.log("\n--- TABLA 4 · Redundancia vs att/def/mu de V1 ---");
  for (const [par, x] of Object.entries(redundancia)) {
    console.log(`${par.padEnd(8)} | rΔatt=${String(x.r_deltaFeature_vs_deltaAtt).padStart(6)} | r_feat_att=${String(x.r_feature_vs_att).padStart(6)} r_feat_def=${String(x.r_feature_vs_def).padStart(6)} | r_liga_mu=${String(x.r_ligaFeature_vs_muHome).padStart(6)} (nL=${x.nLigas}) | ${x.interpretacion_delta}`);
  }

  // ---------------- candidatas / descartes ----------------
  const candidatos = VARIANTES.filter((x) => x.id !== "V1" && res[x.id].analisis.candidato)
    .map((x) => x.id).sort((a, b) => res[a].pooled.metricas.logLoss - res[b].pooled.metricas.logLoss);
  const descartadas = VARIANTES.filter((x) => x.id !== "V1" && !res[x.id].analisis.candidato).map((x) => x.id);
  console.log(`\nCANDIDATAS a combinación (≥5 señales + s1+s3+s6): ${candidatos.join(", ") || "(ninguna)"}`);
  for (const c of candidatos) {
    const p = res[c].piso.OFICIAL;
    if (p.n > 0) console.log(`  · ${c}: OFICIAL contaminado por ${p.n} evento(s) de piso → sin-piso ΔOF vs V1 = ${res[c].analisis.piso.deltaOFICIAL_sinPiso} (selección por pooled W1-4, sin eventos de piso)`);
  }
  console.log(`DESCARTADAS: ${descartadas.join(", ")}`);

  // ---------------- modelo 2T: conservar candidatas (sin entrenar) ----------------
  const f5 = JSON.parse(fs.readFileSync(path.join(__dirname, "informes", "fase5_ingenieria_variables.json"), "utf8"));
  const nombres2T = ["Accurate passes", "Passes", "Ball possession", "Final third entries", "Total shots", "Expected goals", "Shots inside box"];
  const modelo2T = {
    estado: "CONSERVADO SIN ENTRENAR (fase posterior)",
    candidatas: nombres2T.map((n) => ({
      stat: n,
      corr_prepartido_rolling1T_vs_goles2T: (f5.modelo_goles_2T_variables.predictores_prepartido_top.find((x) => x.predictor_rolling5_1ST === n) || {}).corr_delta1ST_vs_goles2T ?? null,
      corr_mismo_partido_1T_vs_goles2T: (f5.modelo_goles_2T_variables.predictores_mismo_partido_1ST_top.find((x) => x.predictor_1ST === n) || {}).corr_vs_goles_2T ?? null,
      fuente: "experimentos_fase5/informes/fase5_ingenieria_variables.json (TRAIN+VAL)",
    })),
    hallazgos_clave: {
      goles1T_vs_goles2T: f5.modelo_goles_2T_variables.r_mismo_partido_goles1T_vs_goles2T,
      estado_al_descanso: f5.modelo_goles_2T_variables.estado_al_descanso_local,
      advertencia_leakage: f5.modelo_goles_2T_variables.advertencia_leakage,
    },
  };

  // ---------------- INFORME ----------------
  const informe = {
    generado: new Date().toISOString(),
    fase: "5.1 — Valor incremental de variables Tier A sobre V1",
    reglas: [
      "TEST NO cargado (SQL fecha <= 2026-06-18). Splits oficiales del JSON. Ventanas día-estricto idénticas a fases previas.",
      "Mismo protocolo: pooled = W1-4; selección LL > Brier > ECE > Accuracy + estabilidad (≥3/4 ventanas).",
      "Experimentos INDIVIDUALES; sin combinaciones masivas (quedan preparadas para fase siguiente).",
      "Ventanas: MA5 siempre; MA10/20 sólo donde Fase 5 justificó por ICC (TP/F3P: 5/10; AP/PA: 5/10/20; F3E/SIB: sólo 5).",
      "Normalización sólo para eta²>=0.05: Touches (.065), Accurate passes (.091), Passes (.090) — comparadas contra su versión sin normalizar.",
      "Sin xGOT/Through balls/Hit woodwork/Big chances (cobertura insuficiente). Total shots/Shots on target/xG no se repiten (ya probados en fases previas).",
      "Sin DDL/DML, sin reglas por liga, sin selección por correlación.",
      "lrCovFactor por variante = 0.05·min(1, 25/escala²) con escala = p95(|x|) de la familia en el fit: el trainer está calibrado para escala ~5 (modelo_stats_exp.js:21-24) y las crudas grandes (toques ~25, passes ~500) divergen; es reparametrización de la ruta de optimización (objetivo, l2Cov y óptimo idénticos). Registrado por ventana en coeficientes.",
    ],
    senales_definicion: {
      s1: "ΔLL pooled < 0",
      s2: "ΔLL empate < 0",
      s3: "ΔBrier ≤ 0",
      s4: "ΔECE ≤ +0.0005",
      s5: "ΔBrier empate ≤ 0",
      s6: "≥3/4 ventanas con LL < V1",
      s7: "ningún recall H/E/A empeora > 0.02",
      candidato: "s1 && s3 && s6 && total ≥ 5",
      senalDebil: "s1 pero ΔBrier>0.002 o ΔECE>0.01 o <3 ventanas → no promover",
    },
    sanidad: { v1OficialIgualJson: ok1, v1PooledIgualFase33: ok2, ventanasIgualesFase33: ok3 },
    diagnostico_piso: {
      definicion: `evento de piso = partido con ll>${UMBRAL_PISO} (p_real<2e-9; el piso numérico es 1e-15 ⇒ ll=34.54)`,
      causa: "V1 ya predice λ_home=10.55 en Málaga CF v Almería (0-0, 2026-06-14): 'La Liga Dos 2025' NO existe en ligas (ni del fit ni del JSON oficial; la liga entra en el dataset en mayo-2026 tras su nombre/nuevo arranque) → fallback a μ global con att/def identificados en otra liga. Cualquier perturbación de ±0.5% de λ hunde p_draw bajo el piso y añade ~+28 LL a la ventana OFICIAL (28/364≈0.077).",
      eventosPooled: pisoPooledTotal,
      afectadosOFICIAL: pisoOficialAfectados,
      uso: "DIAGNÓSTICO SÓLO: la selección usa las métricas del protocolo (pooled W1-4), y los eventos en pooled son 0. El campo deltaOFICIAL_sinPiso y logLoss_sinPiso permiten ver el orden real sin el partido contaminado.",
      umbral: UMBRAL_PISO,
    },
    ventanas: ventanas.map((w) => ({ nombre: w.nombre, fit: w.fit.length, eval: w.eval.length,
      desde: new Date(w.eval[0].fecha).toISOString().slice(0, 10),
      hasta: new Date(w.eval[w.eval.length - 1].fecha).toISOString().slice(0, 10) })),
    baseline_V1: {
      oficial: res.V1.ventanas.OFICIAL.metricas,
      pooled: { accuracy: r4(base.accuracy), logLoss: r4(base.logLoss), brier: base.brier, ece: base.ece,
        llEmpate: res.V1.pooled.llEmp, brierEmpate: res.V1.pooled.brierEmp,
        recall: Object.fromEntries(CLASES.map((c) => [c, r4(res.V1.pooled.ext.por[c].recall)])),
        distPred: res.V1.pooled.ext.cnt, distProb: res.V1.pooled.ext.prom },
      porVentana: Object.fromEntries(Object.entries(res.V1.ventanas).map(([k, x]) =>
        [k, { accuracy: r4(x.metricas.accuracy), logLoss: r4(x.metricas.logLoss), brier: x.metricas.brier, ece: x.metricas.ece, llEmpate: x.llEmp }])),
    },
    experimentos: {},
    ranking: orden,
    candidatas_a_combinacion: candidatos,
    candidatas_piso_oficial: Object.fromEntries(candidatos.map((c) => [c, {
      n: res[c].piso.OFICIAL.n,
      deltaOFICIAL_sinPiso: res[c].analisis.piso.deltaOFICIAL_sinPiso,
      eventos: res[c].piso.OFICIAL.eventos,
    }])),
    descartadas,
    redundancia,
    modelo_2T_conservado: modelo2T,
    verificacion: "pendiente post-ejecución",
  };

  for (const id of orden) {
    const rr = res[id];
    const a = rr.analisis;
    informe.experimentos[id] = {
      desc: rr.desc,
      pooled: {
        accuracy: r4(rr.pooled.metricas.accuracy), logLoss: r4(rr.pooled.metricas.logLoss),
        brier: rr.pooled.metricas.brier, ece: rr.pooled.metricas.ece,
        llEmpate: rr.pooled.llEmp, brierEmpate: rr.pooled.brierEmp,
        recall: Object.fromEntries(CLASES.map((c) => [c, r4(rr.pooled.ext.por[c].recall)])),
        distPred: rr.pooled.ext.cnt, distProb: rr.pooled.ext.prom,
      },
      porVentana: Object.fromEntries(Object.entries(rr.ventanas).map(([k, x]) => [k, {
        n: x.items.length,
        accuracy: r4(x.metricas.accuracy), logLoss: r4(x.metricas.logLoss),
        brier: x.metricas.brier, ece: x.metricas.ece,
        llEmpate: x.llEmp, brierEmpate: x.brierEmp,
        recall: Object.fromEntries(CLASES.map((c) => [c, x.ext.por[c].recall === null ? null : r4(x.ext.por[c].recall)])),
        deltaLLvsV1: r4(x.metricas.logLoss - res.V1.ventanas[k].metricas.logLoss),
      }])),
      piso: rr.piso,
      ...(id !== "V1" ? {
        deltaVsV1: a.deltas,
        senales: a.senales, totalSenales: a.totalSenales,
        ventanasGanaLL: a.ventanasGanaLL, peorDeltaRecall: a.peorDeltaRecall,
        candidato: a.candidato, senalDebil: a.senalDebil,
        coeficientes: rr.coef,
        porLiga: rr.porLiga,
      } : {}),
    };
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(informe, null, 2), "utf8");
  console.log(`\nInforme: ${OUT}`);
  console.log("TEST: NO EVALUADO. Fase 6: NO ejecutada (a la espera de revisión).");
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
