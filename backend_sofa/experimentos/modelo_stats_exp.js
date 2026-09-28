// ---------------------------------------------------------------------------
// EXPERIMENTAL — trainer Poisson con familias de covariables (FASE 2).
// V1 no se modifica. Estructura:
//
//   log λ_local = log μ_local + (att_L − def_V) + βE·(Δelo/400) + Σ_f [ bf_f·for_L_f + ba_f·ag_V_f ]
//   log λ_vis  = log μ_vis  + (att_V − def_L) − βE·(Δelo/400) + Σ_f [ bf_f·for_V_f + ba_f·ag_L_f ]
//
//   for_* = feature "qué produce el equipo" (xG anotado, tiros, ...) normalizada
//   ag_*  = feature "qué recibe el equipo" (xG recibido, tiros recibidos, ...)
//   bf/ba se estiman por MLE (mismo SGD que V1). Sin reglas manuales.
//
// cfg = { elo: bool, familias: [{nombre, forL, agL, forV, agV}] }
// ---------------------------------------------------------------------------
const { calcularLigas } = require("./modelo_mu_exp");

const EPS = 1e-9;
const logLik = (y, l) => y * Math.log(l + EPS) - l;
const val = (p, k) => { const v = p[k]; return Number.isFinite(v) ? v : 0; };

function entrenarFeatures(partidos, estrategia, cfg = {}, opts = {}) {
  // lrCovFactor: las familias de stats usan lr reducido (×0.05) por estabilidad —
  // las features "crudas" sin centrar (escala ~4 con el mismo lr que att/def)
  // divergen por realimentación exponencial de λ. βE (Elo) mantiene el lr
  // completo para paridad exacta con fase_elo. Reparametrización de optimización,
  // no de modelo: el óptimo MLE es el mismo.
  const { epochs = 400, lrInicial = 0.05, l2 = 0.05, l2Cov = 0.01, lrCovFactor = 0.05 } = opts;
  const { elo = false, familias = [] } = cfg;
  if (!partidos.length) throw new Error("No hay partidos para entrenar");

  const att = new Map();
  const def = new Map();
  for (const p of partidos) {
    if (!att.has(p.home)) att.set(p.home, 0);
    if (!att.has(p.away)) att.set(p.away, 0);
    if (!def.has(p.home)) def.set(p.home, 0);
    if (!def.has(p.away)) def.set(p.away, 0);
  }
  const { ligas, muGlobal } = calcularLigas(partidos, estrategia);
  const muDe = (l) => ligas[l] || muGlobal;

  let betaE = 0;
  const cov = {};
  for (const f of familias) cov[f.nombre] = { bf: 0, ba: 0 };

  const orden = [...partidos.keys()];
  let lr = lrInicial;
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = orden.length - 1; i > 0; i--) {
      const j = (i * 1103515245 + 12345 + epoch * 2654435761) % (i + 1);
      [orden[i], orden[j]] = [orden[j], orden[i]];
    }
    for (const idx of orden) {
      const p = partidos[idx];
      const base = muDe(p.liga);
      const xE = elo ? ((p.eloHome ?? 0) - (p.eloAway ?? 0)) / 400 : 0;
      let exH = 0, exA = 0;
      for (const f of familias) {
        const c = cov[f.nombre];
        exH += c.bf * val(p, f.forL) + c.ba * val(p, f.agV);
        exA += c.bf * val(p, f.forV) + c.ba * val(p, f.agL);
      }
      if (elo) { exH += betaE * xE; exA -= betaE * xE; }

      const lh = Math.exp(Math.log(base.muHome) + att.get(p.home) - def.get(p.away) + exH);
      const la = Math.exp(Math.log(base.muAway) + att.get(p.away) - def.get(p.home) + exA);
      const gH = p.goalsH - lh;
      const gA = p.goalsA - la;

      att.set(p.home, att.get(p.home) + lr * (gH - l2 * att.get(p.home)));
      def.set(p.away, def.get(p.away) + lr * (-gH - l2 * def.get(p.away)));
      att.set(p.away, att.get(p.away) + lr * (gA - l2 * att.get(p.away)));
      def.set(p.home, def.get(p.home) + lr * (-gA - l2 * def.get(p.home)));
      if (elo) betaE += lr * ((gH - gA) * xE - l2Cov * betaE);
      for (const f of familias) {
        const c = cov[f.nombre];
        const xFL = val(p, f.forL), xFV = val(p, f.forV);
        const xAL = val(p, f.agL), xAV = val(p, f.agV);
        const lrC = lr * lrCovFactor;
        c.bf += lrC * (gH * xFL + gA * xFV - l2Cov * c.bf);
        c.ba += lrC * (gH * xAV + gA * xAL - l2Cov * c.ba);
      }
    }
    lr *= 0.995;
  }

  let ll = 0;
  for (const p of partidos) {
    const { lambdaHome, lambdaAway } = lambdasFeatures({ cfg: { elo, familias }, betaE, cov, ligas, muGlobal: muGlobal, att: Object.fromEntries(att), def: Object.fromEntries(def) }, p);
    ll += logLik(p.goalsH, lambdaHome) + logLik(p.goalsA, lambdaAway);
  }

  return {
    tipo: "poisson",
    version: "1.0-exp-features-familias",
    estrategia,
    cfg: { elo, familias },
    betaE: elo ? Math.round(betaE * 10000) / 10000 : undefined,
    cov: Object.fromEntries(Object.entries(cov).map(([k, v]) => [k, { bf: Math.round(v.bf * 10000) / 10000, ba: Math.round(v.ba * 10000) / 10000 }])),
    muHomeGlobal: muGlobal.muHome,
    muAwayGlobal: muGlobal.muAway,
    ligas,
    att: Object.fromEntries(att),
    def: Object.fromEntries(def),
    entrenamiento: {
      partidos: partidos.length,
      logLikPromedio: Math.round((ll / partidos.length) * 1000) / 1000,
      hiperparametros: { epochs, lrInicial, l2, l2Cov },
    },
  };
}

function lambdasFeatures(modelo, p) {
  const ligas = modelo.ligas || {};
  const base = ligas[p.liga] || { muHome: modelo.muHomeGlobal, muAway: modelo.muAwayGlobal };
  const att = modelo.att || {}, def = modelo.def || {};
  const { elo = false, familias = [] } = modelo.cfg || {};
  let exH = 0, exA = 0;
  if (elo) {
    const xE = ((p.eloHome ?? 0) - (p.eloAway ?? 0)) / 400;
    exH += (modelo.betaE || 0) * xE;
    exA -= (modelo.betaE || 0) * xE;
  }
  for (const f of familias) {
    const c = (modelo.cov && modelo.cov[f.nombre]) || { bf: 0, ba: 0 };
    exH += c.bf * val(p, f.forL) + c.ba * val(p, f.agV);
    exA += c.bf * val(p, f.forV) + c.ba * val(p, f.agL);
  }
  return {
    lambdaHome: Math.exp(Math.log(base.muHome) + (att[p.home] ?? 0) - (def[p.away] ?? 0) + exH),
    lambdaAway: Math.exp(Math.log(base.muAway) + (att[p.away] ?? 0) - (def[p.home] ?? 0) + exA),
  };
}

module.exports = { entrenarFeatures, lambdasFeatures };
