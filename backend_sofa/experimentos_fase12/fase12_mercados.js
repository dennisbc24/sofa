// ---------------------------------------------------------------------------
// FASE 12 â€” EXPERIMENTO DE MERCADOS PRE-PARTIDO.
//
// Compara el baseline de producciÃ³n contra candidatos con ajuste por rival
// (ataque propio Ã— defensa rival / media de liga), shrinkage y blend.
//
// Mercados:
//  - Goles total / 1T / 2T (baseline = lambdas V1 + share histÃ³rico).
//  - Remates total / 1T / 2T (baseline = media histÃ³rica de producciÃ³n).
//  - Corners total / 1T / 2T (baseline = media histÃ³rica de producciÃ³n).
//  - Over/Under: Poisson (producciÃ³n) vs Binomial Negativa.
//  - Ganador 1X2: V1 vs V1+Elo (chequeo de no-regresiÃ³n).
//
// Protocolo:
//  - TV = TRAIN (<= 2026-05-02) + VAL (<= 2026-06-18). TEST no se carga salvo
//    que se pase --test (evaluaciÃ³n final Ãºnica).
//  - Ventanas rolling dÃ­a-estricto W1-W4 + OFICIAL, igual que fases previas.
//  - SelecciÃ³n por mejora fuera de muestra (MAE/RMSE y LL de over/under),
//    estabilidad en >=3/4 ventanas.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { cargarPartidos, construirFeatures, dia } = require("./comun12");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { entrenarConFeatures, lambdasExp } = require("../experimentos/modelo_elo_exp");
const { calcularElo } = require("../experimentos/elo");
const { calcularMetricas } = require("../services/prediccion/backtest");
const { construirVentanas } = require("../experimentos_fase3/comun");

const TRAIN_HASTA = "2026-05-02";
const VAL_HASTA = "2026-06-18";
const TEST_HASTA = "2026-09-27";
const CON_TEST = process.argv.includes("--test");
const HASTA = CON_TEST ? TEST_HASTA : VAL_HASTA;
const OUT = path.join(
  __dirname,
  "informes",
  CON_TEST ? "fase12_mercados_test.json" : "fase12_mercados_tv.json"
);

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r4 = (x) => (x === null || x === undefined ? null : Math.round(x * 10000) / 10000);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function metricasPunto(items, campo = "total") {
  const xs = items
    .map((x) => ({ p: x.pred[campo], r: x.real[campo] }))
    .filter((x) => x.p !== null && x.p !== undefined && Number.isFinite(x.p) && x.r !== null);
  if (!xs.length) return { n: 0 };
  const err = xs.map((x) => x.p - x.r);
  return {
    n: xs.length,
    mae: r4(mean(err.map((e) => Math.abs(e)))),
    rmse: r4(Math.sqrt(mean(err.map((e) => e * e)))),
    bias: r4(mean(err)),
    corr: (() => {
      const mx = mean(xs.map((x) => x.p));
      const my = mean(xs.map((x) => x.r));
      let sxy = 0, sxx = 0, syy = 0;
      for (const x of xs) {
        const dx = x.p - mx, dy = x.r - my;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
      }
      return sxx > 0 && syy > 0 ? r4(sxy / Math.sqrt(sxx * syy)) : null;
    })(),
  };
}

function metricasLado(items) {
  const flat = [];
  for (const x of items) {
    const ps = x.pred.predSide;
    if (!ps || !x.realSide) continue;
    for (const side of ["home", "away"]) {
      flat.push({
        pred: { total: ps[side].total },
        real: { total: x.realSide[side].total },
      });
    }
  }
  return metricasPunto(flat, "total");
}

const pmfPoisson = (k, lambda) => {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / f;
};
const pNoMasDe = (max, lambda) => {
  let s = 0;
  for (let i = 0; i <= max; i++) s += pmfPoisson(i, lambda);
  return s;
};

// NB con media mu y dispersiÃ³n r: p0=(r/(r+mu))^r; p_k=p_{k-1}*(k+r-1)/k*mu/(r+mu).
function nbPmf(maxK, mu, r) {
  const out = new Array(maxK + 1).fill(0);
  const p = mu / (mu + r);
  out[0] = Math.pow(r / (r + mu), r);
  for (let k = 1; k <= maxK; k++) out[k] = out[k - 1] * ((k + r - 1) / k) * p;
  return out;
}

function convolve(a, b, maxK) {
  const out = new Array(maxK + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length && i + j <= maxK; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

function pOverPoisson(muH, muA, line) {
  return 1 - pNoMasDe(Math.floor(line), muH + muA);
}

function pOverNB(muH, muA, line, r, maxK = 100) {
  const a = nbPmf(maxK, Math.max(muH, 1e-6), r);
  const b = nbPmf(maxK, Math.max(muA, 1e-6), r);
  const c = convolve(a, b, maxK);
  let s = 0;
  for (let k = 0; k <= Math.floor(line); k++) s += c[k];
  return clamp(1 - s, 1e-9, 1 - 1e-9);
}

function metricasOver(items, lines, tipo, r) {
  const out = [];
  for (const line of lines) {
    let ll = 0, br = 0, n = 0;
    for (const x of items) {
      if (!x.mu || x.real.total === null) continue;
      const p =
        tipo === "poisson"
          ? pOverPoisson(x.mu.home, x.mu.away, line)
          : pOverNB(x.mu.home, x.mu.away, line, r);
      const y = x.real.total > line ? 1 : 0;
      const pp = clamp(p, 1e-6, 1 - 1e-6);
      ll += -(y * Math.log(pp) + (1 - y) * Math.log(1 - pp));
      br += (pp - y) ** 2;
      n += 1;
    }
    out.push({ line, n, logLoss: r4(ll / n), brier: r4(br / n) });
  }
  return {
    avgLogLoss: r4(mean(out.map((x) => x.logLoss))),
    avgBrier: r4(mean(out.map((x) => x.brier))),
    porLinea: out,
  };
}

function mix(b, a, w) {
  if (b === null || b === undefined) return a;
  if (a === null || a === undefined) return b;
  return w * b + (1 - w) * a;
}

function segmento(items, lines, r, filtro) {
  const arr = filtro ? items.filter(filtro) : items;
  if (!arr.length) return null;
  return {
    n: arr.length,
    total: metricasPunto(arr, "total"),
    first: metricasPunto(arr, "first"),
    second: metricasPunto(arr, "second"),
    lado: metricasLado(arr),
    overNB: metricasOver(arr, lines, "nb", r),
    overPoisson: metricasOver(arr, lines, "poisson"),
  };
}

function segmentosDe(items, lines, r, key) {
  const nMinDe = (x) =>
    Math.min(
      x.p.f.home[key].base.n ?? 0,
      x.p.f.away[key].base.n ?? 0
    );
  const ligas = new Map();
  for (const x of items) {
    const k = x.p.base || "General";
    if (!ligas.has(k)) ligas.set(k, []);
    ligas.get(k).push(x);
  }
  const porLiga = [];
  for (const [liga, arr] of ligas) {
    if (arr.length < 15) continue;
    porLiga.push({ liga, ...segmento(arr, lines, r) });
  }
  porLiga.sort((a, b) => b.n - a.n);
  const porMuestra = [
    { id: "n0-4", min: 0, max: 4 },
    { id: "n5-9", min: 5, max: 9 },
    { id: "n10+", min: 10, max: Infinity },
  ]
    .map((b) => {
      const s = segmento(
        items,
        lines,
        r,
        (x) => {
          const n = nMinDe(x);
          return n >= b.min && n <= b.max;
        }
      );
      return s ? { id: b.id, ...s } : null;
    })
    .filter(Boolean);
  return { porLiga, porMuestra };
}

function lado(p, side, key, cand) {
  const f = p.f[side][key];
  if (cand.tipo === "base") return { ...f.base, nMin: f.base.n };
  const a = f.ws[cand.W][cand.cond ? "cond" : "general"];
  const nMinAdj = Math.min(a.nOwn ?? 0, a.nOpp ?? 0);
  if (cand.tipo === "adj") return { ...a, nMin: nMinAdj };
  return {
    total: mix(f.base.total, a.total, cand.w),
    first: mix(f.base.first, a.first, cand.w),
    second: mix(f.base.second, a.second, cand.w),
    share: f.base.share,
    n: f.base.n,
    nMin: Math.min(f.base.n ?? 0, nMinAdj),
  };
}

function predStats(p, cand, key) {
  const h = lado(p, "home", key, cand);
  const a = lado(p, "away", key, cand);
  const total = h.total !== null && a.total !== null ? h.total + a.total : null;
  const first = h.first !== null && a.first !== null ? h.first + a.first : null;
  const second = h.second !== null && a.second !== null ? h.second + a.second : null;
  return {
    total,
    first,
    second,
    predSide: { home: h, away: a },
    mu: { home: h.total, away: a.total },
    nMin:
      h.nMin === null || h.nMin === undefined || a.nMin === null || a.nMin === undefined
        ? null
        : Math.min(h.nMin, a.nMin),
  };
}

function v1Pred(p, modelo) {
  const { lambdaHome, lambdaAway } = lambdasExp(modelo, p);
  const shH = p.f.home.goals.base.share;
  const shA = p.f.away.goals.base.share;
  const first = lambdaHome * shH + lambdaAway * shA;
  const total = lambdaHome + lambdaAway;
  return {
    total,
    first,
    second: total - first,
    predSide: {
      home: { total: lambdaHome, first: lambdaHome * shH, second: lambdaHome * (1 - shH) },
      away: { total: lambdaAway, first: lambdaAway * shA, second: lambdaAway * (1 - shA) },
    },
    mu: { home: lambdaHome, away: lambdaAway },
    nMin: null,
  };
}

function predGoals(p, cand, modelo) {
  if (cand.tipo === "v1") return v1Pred(p, modelo);
  const h = lado(p, "home", "goals", cand);
  const a = lado(p, "away", "goals", cand);
  const total = h.total !== null && a.total !== null ? h.total + a.total : null;
  const first = h.first !== null && a.first !== null ? h.first + a.first : null;
  const second = h.second !== null && a.second !== null ? h.second + a.second : null;
  if (cand.tipo === "blendV1") {
    const v = v1Pred(p, modelo);
    return {
      total: mix(v.total, total, cand.w),
      first: mix(v.first, first, cand.w),
      second: mix(v.second, second, cand.w),
      predSide: v.predSide,
      mu: { home: mix(v.mu.home, h.total, cand.w), away: mix(v.mu.away, a.total, cand.w) },
      nMin:
        h.nMin === null || h.nMin === undefined || a.nMin === null || a.nMin === undefined
          ? null
          : Math.min(h.nMin, a.nMin),
    };
  }
  return {
    total,
    first,
    second,
    predSide: { home: h, away: a },
    mu: { home: h.total, away: a.total },
    nMin:
      h.nMin === null || h.nMin === undefined || a.nMin === null || a.nMin === undefined
        ? null
        : Math.min(h.nMin, a.nMin),
  };
}

function itemsDe(evalMatches, predFn, realFn) {
  const items = [];
  for (const p of evalMatches) {
    const pred = predFn(p);
    if (pred.total === null || pred.total === undefined) continue;
    const real = realFn(p);
    if (real.total === null || real.total === undefined) continue;
    items.push({ p, pred, real, realSide: real.side, mu: pred.mu });
  }
  return items;
}

function realStats(p, key) {
  const h = p.stats[key].home;
  const a = p.stats[key].away;
  return {
    total: h.total !== null && a.total !== null ? h.total + a.total : null,
    first: h.first !== null && a.first !== null ? h.first + a.first : null,
    second: h.second !== null && a.second !== null ? h.second + a.second : null,
    side: {
      home: { total: h.total, first: h.first, second: h.second },
      away: { total: a.total, first: a.first, second: a.second },
    },
  };
}

function realGoals(p) {
  const first = p.gh1 === null || p.ga1 === null ? null : p.gh1 + p.ga1;
  const total = p.gh + p.ga;
  return {
    total,
    first,
    second: first === null ? null : total - first,
    side: {
      home: { total: p.gh, first: p.gh1, second: p.gh1 === null ? null : p.gh - p.gh1 },
      away: { total: p.ga, first: p.ga1, second: p.ga1 === null ? null : p.ga - p.ga1 },
    },
  };
}

function dispersion(items) {
  const ys = items.map((x) => x.real.total).filter((v) => v !== null);
  if (ys.length < 30) return 100;
  const m = mean(ys);
  const v = mean(ys.map((y) => (y - m) ** 2));
  if (v <= m) return 1e6;
  return Math.max(2, (m * m) / (v - m));
}

function metricasComunes(itemsPorCand, lines) {
  const ids = Object.keys(itemsPorCand);
  if (!ids.length) return {};
  const sets = ids.map((id) => new Set(itemsPorCand[id].map((x) => x.p.id)));
  const minSet = sets.reduce((a, b) => (a.size <= b.size ? a : b));
  const comunes = new Set([...minSet].filter((id) => sets.every((s) => s.has(id))));
  const out = {};
  for (const id of ids) {
    const arr = itemsPorCand[id].filter((x) => comunes.has(x.p.id));
    const r = dispersion(arr);
    out[id] = {
      n: arr.length,
      total: metricasPunto(arr, "total"),
      first: metricasPunto(arr, "first"),
      second: metricasPunto(arr, "second"),
      lado: metricasLado(arr, "total"),
      overPoisson: metricasOver(arr, lines, "poisson"),
      overNB: metricasOver(arr, lines, "nb", r),
    };
  }
  return out;
}

function evaluarCandidatos({ nombre, datasetTV, datasetTest, candidatos, predFn, realFn, lines, key, conV1 }) {
  const nTrain = datasetTV.filter((p) => dia(p.fecha) <= TRAIN_HASTA).length;
  const { oficial, ventanas } = construirVentanas(datasetTV, nTrain);
  const ventanasTodas = [oficial, ...ventanas];

  const res = {};
  const itemsPool = {};
  const itemsTest = {};
  for (const cand of candidatos) {
    res[cand.id] = { desc: cand.desc, ventanas: {}, pooled: null, test: null };
    const pooledItems = [];
    itemsPool[cand.id] = pooledItems;
    for (const win of ventanasTodas) {
      const modelo = conV1 ? entrenarExp(win.fit, "SPEC30") : null;
      const evalMatches = win.eval;
      const items = itemsDe(evalMatches, (p) => predFn(p, cand, modelo), realFn);
      const r = dispersion(items);
      const pointTotal = metricasPunto(items, "total");
      const pointFirst = metricasPunto(items, "first");
      const pointSecond = metricasPunto(items, "second");
      const pointSide = metricasLado(items, "total");
      const overP = metricasOver(items, lines, "poisson");
      const overNB = metricasOver(items, lines, "nb", r);
      res[cand.id].ventanas[win.nombre] = {
        n: items.length,
        r,
        total: pointTotal,
        first: pointFirst,
        second: pointSecond,
        lado: pointSide,
        overPoisson: overP,
        overNB,
      };
      if (win.nombre !== "OFICIAL") pooledItems.push(...items);
    }
    // pooled W1-W4
    const rPool = dispersion(pooledItems);
    res[cand.id].pooled = {
      n: pooledItems.length,
      r: rPool,
      total: metricasPunto(pooledItems, "total"),
      first: metricasPunto(pooledItems, "first"),
      second: metricasPunto(pooledItems, "second"),
      lado: metricasLado(pooledItems, "total"),
      overPoisson: metricasOver(pooledItems, lines, "poisson"),
      overNB: metricasOver(pooledItems, lines, "nb", rPool),
      segmentos: segmentosDe(pooledItems, lines, rPool, key),
    };

    if (datasetTest && datasetTest.length) {
      const modelo = conV1 ? entrenarExp(datasetTV, "SPEC30") : null;
      const items = itemsDe(datasetTest, (p) => predFn(p, cand, modelo), realFn);
      itemsTest[cand.id] = items;
      const r = dispersion(items);
      res[cand.id].test = {
        n: items.length,
        r,
        total: metricasPunto(items, "total"),
        first: metricasPunto(items, "first"),
        second: metricasPunto(items, "second"),
        lado: metricasLado(items, "total"),
        overPoisson: metricasOver(items, lines, "poisson"),
        overNB: metricasOver(items, lines, "nb", r),
        segmentos: segmentosDe(items, lines, r, key),
      };
    }
  }

  const poolComun = metricasComunes(itemsPool, lines);
  const testComun =
    datasetTest && datasetTest.length ? metricasComunes(itemsTest, lines) : null;
  for (const cand of candidatos) {
    res[cand.id].pooledComun = poolComun[cand.id] || null;
    if (testComun) res[cand.id].testComun = testComun[cand.id] || null;
  }

  // Comparativa contra baseline (primer candidato).
  const baseId = candidatos[0].id;
  const base = res[baseId];
  const analisis = {};
  for (const cand of candidatos.slice(1)) {
    const c = res[cand.id];
    const dMAE = c.pooled.total.mae - base.pooled.total.mae;
    const dRMSE = c.pooled.total.rmse - base.pooled.total.rmse;
    const dLL = c.pooled.overNB.avgLogLoss - base.pooled.overPoisson.avgLogLoss;
    const dLLp = c.pooled.overPoisson.avgLogLoss - base.pooled.overPoisson.avgLogLoss;
    const dLLnb = c.pooled.overNB.avgLogLoss - base.pooled.overNB.avgLogLoss;
    const ganaMAE = ["W1", "W2", "W3", "W4"].filter(
      (w) => c.ventanas[w].total.mae < base.ventanas[w].total.mae
    ).length;
    const ganaLL = ["W1", "W2", "W3", "W4"].filter(
      (w) => c.ventanas[w].overNB.avgLogLoss < base.ventanas[w].overPoisson.avgLogLoss
    ).length;
    const bComun = base.pooledComun;
    const cComun = c.pooledComun;
    analisis[cand.id] = {
      dMAE_pooled: r4(dMAE),
      dRMSE_pooled: r4(dRMSE),
      dLL_pooled_NBvsBasePoisson: r4(dLL),
      dLL_pooled_Poisson: r4(dLLp),
      dLL_pooled_NB: r4(dLLnb),
      dMAE_comun: bComun && cComun ? r4(cComun.total.mae - bComun.total.mae) : null,
      dRMSE_comun: bComun && cComun ? r4(cComun.total.rmse - bComun.total.rmse) : null,
      dLL_comun_Poisson:
        bComun && cComun
          ? r4(cComun.overPoisson.avgLogLoss - bComun.overPoisson.avgLogLoss)
          : null,
      dLL_comun_NB:
        bComun && cComun ? r4(cComun.overNB.avgLogLoss - bComun.overNB.avgLogLoss) : null,
      ventanasGanaMAE: ganaMAE,
      ventanasGanaLL: ganaLL,
      candidato:
        dMAE < 0 && dRMSE < 0 && ganaMAE >= 3 && c.pooled.overNB.avgLogLoss < base.pooled.overPoisson.avgLogLoss,
    };
  }

  return { mercado: nombre, key, lines, baseline: baseId, candidatos: res, analisis };
}

(async () => {
  console.log(`=========== FASE 12 Â· MERCADOS Â· hasta ${HASTA} ===========`);
  const partidos = await cargarPartidos(HASTA);
  construirFeatures(partidos);
  console.log(`partidos cargados: ${partidos.length}`);

  // Elo (antes de cada partido) para el chequeo de ganador.
  const elo = calcularElo(
    partidos.map((p) => ({ home: p.home, away: p.away, goalsH: p.gh, goalsA: p.ga })),
    { k: 32, homeAdv: 100 }
  );
  partidos.forEach((p, i) => {
    p.eloHome = elo.antes[i].home;
    p.eloAway = elo.antes[i].away;
  });

  const TV = partidos.filter((p) => dia(p.fecha) <= VAL_HASTA);
  const TEST = partidos.filter((p) => dia(p.fecha) > VAL_HASTA && dia(p.fecha) <= TEST_HASTA);

  const shotsTV = TV.filter(
    (p) => p.stats.shots.home.total !== null && p.stats.shots.away.total !== null
  );
  const shotsTest = TEST.filter(
    (p) => p.stats.shots.home.total !== null && p.stats.shots.away.total !== null
  );
  const cornersTV = TV.filter(
    (p) => p.stats.corners.home.total !== null && p.stats.corners.away.total !== null
  );
  const cornersTest = TEST.filter(
    (p) => p.stats.corners.home.total !== null && p.stats.corners.away.total !== null
  );
  const g1TV = TV.filter((p) => p.gh1 !== null && p.ga1 !== null);
  const g1Test = TEST.filter((p) => p.gh1 !== null && p.ga1 !== null);

  console.log(
    `TV=${TV.length} (shots ${shotsTV.length}, corners ${cornersTV.length}, 1T ${g1TV.length})` +
      (CON_TEST ? ` | TEST=${TEST.length} (shots ${shotsTest.length}, corners ${cornersTest.length}, 1T ${g1Test.length})` : "")
  );

  const candsStats = [
    { id: "base", desc: "producciÃ³n: media histÃ³rica (Ãºlt. 40, condiciÃ³n si n>=3)", tipo: "base" },
    { id: "adj10g", desc: "ajuste rival W10 general", tipo: "adj", W: 10, cond: false },
    { id: "adj10c", desc: "ajuste rival W10 condiciÃ³n", tipo: "adj", W: 10, cond: true },
    { id: "adj40g", desc: "ajuste rival W40 general", tipo: "adj", W: 40, cond: false },
    { id: "adj40c", desc: "ajuste rival W40 condiciÃ³n", tipo: "adj", W: 40, cond: true },
    { id: "bl10c50", desc: "blend 50% base + 50% adj W10 condiciÃ³n", tipo: "blend", W: 10, cond: true, w: 0.5 },
    { id: "bl40c50", desc: "blend 50% base + 50% adj W40 condiciÃ³n", tipo: "blend", W: 40, cond: true, w: 0.5 },
  ];

  const candsGoals = [
    { id: "v1", desc: "V1 Poisson + share 1T histÃ³rico", tipo: "v1" },
    { id: "adj10g", desc: "ajuste rival W10 general", tipo: "adj", W: 10, cond: false },
    { id: "adj10c", desc: "ajuste rival W10 condiciÃ³n", tipo: "adj", W: 10, cond: true },
    { id: "adj40g", desc: "ajuste rival W40 general", tipo: "adj", W: 40, cond: false },
    { id: "adj40c", desc: "ajuste rival W40 condiciÃ³n", tipo: "adj", W: 40, cond: true },
    { id: "bl10c50", desc: "blend 50% V1 + 50% adj W10 condiciÃ³n", tipo: "blendV1", W: 10, cond: true, w: 0.5 },
    { id: "bl40c50", desc: "blend 50% V1 + 50% adj W40 condiciÃ³n", tipo: "blendV1", W: 40, cond: true, w: 0.5 },
  ];

  const lineas = {
    shots: [20.5, 23.5, 25.5, 27.5, 30.5],
    corners: [6.5, 8.5, 9.5, 10.5, 12.5],
    goals: [1.5, 2.5, 3.5],
  };

  const informes = [];
  informes.push(
    evaluarCandidatos({
      nombre: "Remates",
      datasetTV: shotsTV,
      datasetTest: CON_TEST ? shotsTest : null,
      candidatos: candsStats,
      predFn: (p, c) => predStats(p, c, "shots"),
      realFn: (p) => realStats(p, "shots"),
      lines: lineas.shots,
      key: "shots",
      conV1: false,
    })
  );
  informes.push(
    evaluarCandidatos({
      nombre: "Corners",
      datasetTV: cornersTV,
      datasetTest: CON_TEST ? cornersTest : null,
      candidatos: candsStats,
      predFn: (p, c) => predStats(p, c, "corners"),
      realFn: (p) => realStats(p, "corners"),
      lines: lineas.corners,
      key: "corners",
      conV1: false,
    })
  );
  informes.push(
    evaluarCandidatos({
      nombre: "Goles",
      datasetTV: TV,
      datasetTest: CON_TEST ? TEST : null,
      candidatos: candsGoals,
      predFn: (p, c, m) => predGoals(p, c, m),
      realFn: realGoals,
      lines: lineas.goals,
      key: "goals",
      conV1: true,
    })
  );

  // ---------------- Ganador 1X2: V1 vs V1+Elo ----------------
  const ganador = { ventanas: {}, test: null };
  const nTrain = TV.filter((p) => dia(p.fecha) <= TRAIN_HASTA).length;
  const { oficial, ventanas } = construirVentanas(TV, nTrain);
  for (const win of [oficial, ...ventanas]) {
    const mBase = entrenarExp(win.fit, "SPEC30");
    const mElo = entrenarConFeatures(win.fit, "SPEC30", { conElo: true });
    const ev = (modelo) => {
      const preds = win.eval.map((p) => {
        const { lambdaHome, lambdaAway } = lambdasExp(modelo, p);
        const { home, draw, away } = require("../services/prediccion/modelo_poisson").probsDesdeLambdas(
          lambdaHome,
          lambdaAway
        );
        return {
          fecha: p.fecha,
          home: p.home,
          away: p.away,
          liga: p.liga,
          probs: require("../services/prediccion/modelo_poisson").aPorcentajes(home, draw, away, 1),
          real: p.gh > p.ga ? "home" : p.gh === p.ga ? "draw" : "away",
        };
      });
      return calcularMetricas(preds);
    };
    ganador.ventanas[win.nombre] = {
      n: win.eval.length,
      v1: ev(mBase),
      elo: ev(mElo),
      beta: mElo.beta,
    };
  }
  if (CON_TEST && TEST.length) {
    const mBase = entrenarExp(TV, "SPEC30");
    const mElo = entrenarConFeatures(TV, "SPEC30", { conElo: true });
    const ev = (modelo) => {
      const preds = TEST.map((p) => {
        const { lambdaHome, lambdaAway } = lambdasExp(modelo, p);
        const { home, draw, away } = require("../services/prediccion/modelo_poisson").probsDesdeLambdas(
          lambdaHome,
          lambdaAway
        );
        return {
          fecha: p.fecha,
          home: p.home,
          away: p.away,
          liga: p.liga,
          probs: require("../services/prediccion/modelo_poisson").aPorcentajes(home, draw, away, 1),
          real: p.gh > p.ga ? "home" : p.gh === p.ga ? "draw" : "away",
        };
      });
      return calcularMetricas(preds);
    };
    ganador.test = { n: TEST.length, v1: ev(mBase), elo: ev(mElo), beta: mElo.beta };
  }

  // ---------------- salida ----------------
  const informe = {
    fase: "12_mercados",
    generado: new Date().toISOString(),
    corte: HASTA,
    test_cargado: CON_TEST,
    muestra: {
      partidos: partidos.length,
      tv: TV.length,
      test: TEST.length,
      shots_tv: shotsTV.length,
      corners_tv: cornersTV.length,
      goles_1t_tv: g1TV.length,
    },
    mercados: informes,
    ganador,
  };
  fs.writeFileSync(OUT, JSON.stringify(informe, null, 2));

  for (const m of informes) {
    console.log(`\n===== ${m.mercado} =====`);
    console.log("id      | MAE    | RMSE   | bias   | LL(NB) | LL(Poi)| ventanasMAE | ventanasLL | cand");
    for (const [id, x] of Object.entries(m.candidatos)) {
      const a = m.analisis[id] || {};
      console.log(
        `${id.padEnd(7)} | ${String(x.pooled.total.mae).padStart(6)} | ${String(x.pooled.total.rmse).padStart(6)} | ${String(x.pooled.total.bias).padStart(6)} | ${String(x.pooled.overNB.avgLogLoss).padStart(6)} | ${String(x.pooled.overPoisson.avgLogLoss).padStart(6)} | ${String(a.ventanasGanaMAE ?? "-").padStart(11)} | ${String(a.ventanasGanaLL ?? "-").padStart(10)} | ${a.candidato ? "SÃ" : "no"}`
      );
    }
    console.log(
      `OFICIAL base MAE=${m.candidatos[m.baseline].ventanas.OFICIAL.total.mae} LL=${m.candidatos[m.baseline].ventanas.OFICIAL.overPoisson.avgLogLoss}`
    );
  }
  console.log("\n===== GANADOR 1X2 =====");
  for (const [w, x] of Object.entries(ganador.ventanas)) {
    console.log(
      `${w}: V1 LL=${x.v1.logLoss} Brier=${x.v1.brier} | Elo LL=${x.elo.logLoss} Brier=${x.elo.brier} (beta=${x.beta})`
    );
  }
  if (ganador.test) {
    console.log(
      `TEST: V1 LL=${ganador.test.v1.logLoss} Brier=${ganador.test.v1.brier} | Elo LL=${ganador.test.elo.logLoss} Brier=${ganador.test.elo.brier} (beta=${ganador.test.beta})`
    );
  }
  console.log(`\nInforme: ${OUT}`);
  await pool.end();
})();
