// ---------------------------------------------------------------------------
// EXPERIMENTAL — trainer Poisson con covariables (V2/V3) para FASE 2.
//
// V1 (productivo) NO se modifica. La estructura es la de V1:
//   log λ_local  = log μ_local + (att_local − def_visita) + β·x_elo + γ·x_forma
//   log λ_visit  = log μ_visita + (att_visita − def_local) − β·x_elo − γ·x_forma
//
//   x_elo   = (elo_local − elo_visita) / 400      (rating PREVIO al partido)
//   x_forma = formaLocal − formaVisita            (últimos ≤5 partidos previos)
//
// β y γ se estiman por MLE (mismo SGD que V1) sobre la muestra de ajuste.
// No hay reglas manuales de países/ligas: la fuerza relativa viene de la Elo
// (aprendida de resultados) y de att/def (aprendidos de goles).
// `predecir`/`evaluar` de V1 se reutilizan (los covariables solo existen
// durante el entrenamiento; en predicción el modelo usa att/def/μ como V1
// — para evaluar V2/V3 sobre un partido usamos `evaluarConCovariables`).
//
// NOTA DE EVALUACIÓN: en las ventanas rolling los partidos de eval traen sus
// covariables precalculados (elo/forma previos), así que la evaluación usa
// `evaluarExp` que calcula λ con los mismos términos que el entrenamiento.
// ---------------------------------------------------------------------------
const { calcularLigas } = require("./modelo_mu_exp");

const EPS = 1e-9;
const logLik = (y, lambda) => y * Math.log(lambda + EPS) - lambda;

function entrenarConFeatures(partidos, estrategia, { conElo = false, conForma = false, epochs = 400, lrInicial = 0.05, l2 = 0.05, l2Cov = 0.01 } = {}) {
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
  const muDe = (liga) => ligas[liga] || muGlobal;

  let beta = 0;   // coeficiente Elo
  let gamma = 0;  // coeficiente forma

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
      const xElo = conElo ? (p.eloHome - p.eloAway) / 400 : 0;
      const xForma = conForma ? (p.formaHome - p.formaAway) : 0;
      const lh = Math.exp(Math.log(base.muHome) + att.get(p.home) - def.get(p.away) + beta * xElo + gamma * xForma);
      const la = Math.exp(Math.log(base.muAway) + att.get(p.away) - def.get(p.home) - beta * xElo - gamma * xForma);

      const gH = p.goalsH - lh;
      const gA = p.goalsA - la;

      att.set(p.home, att.get(p.home) + lr * (gH - l2 * att.get(p.home)));
      def.set(p.away, def.get(p.away) + lr * (-gH - l2 * def.get(p.away)));
      att.set(p.away, att.get(p.away) + lr * (gA - l2 * att.get(p.away)));
      def.set(p.home, def.get(p.home) + lr * (-gA - l2 * def.get(p.home)));
      if (conElo) beta += lr * ((gH - gA) * xElo - l2Cov * beta);
      if (conForma) gamma += lr * ((gH - gA) * xForma - l2Cov * gamma);
    }
    lr *= 0.995;
  }

  // log-likelihood de diagnóstico con covariables
  let ll = 0;
  for (const p of partidos) {
    const base = muDe(p.liga);
    const xElo = conElo ? (p.eloHome - p.eloAway) / 400 : 0;
    const xForma = conForma ? (p.formaHome - p.formaAway) : 0;
    const lh = Math.exp(Math.log(base.muHome) + (att.get(p.home) ?? 0) - (def.get(p.away) ?? 0) + beta * xElo + gamma * xForma);
    const la = Math.exp(Math.log(base.muAway) + (att.get(p.away) ?? 0) - (def.get(p.home) ?? 0) - beta * xElo - gamma * xForma);
    ll += logLik(p.goalsH, lh) + logLik(p.goalsA, la);
  }

  return {
    tipo: "poisson",
    version: "1.0-exp-features",
    estrategia,
    conElo, conForma,
    beta: Math.round(beta * 10000) / 10000,
    gamma: Math.round(gamma * 10000) / 10000,
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

// λ exactos de un partido con los covariables del propio partido (evaluación)
function lambdasExp(modelo, p) {
  const ligas = modelo.ligas || {};
  const base = ligas[p.liga] || { muHome: modelo.muHomeGlobal, muAway: modelo.muAwayGlobal };
  const att = modelo.att || {}, def = modelo.def || {};
  const xElo = modelo.conElo ? (p.eloHome - p.eloAway) / 400 : 0;
  const xForma = modelo.conForma ? (p.formaHome - p.formaAway) : 0;
  return {
    lambdaHome: Math.exp(Math.log(base.muHome) + (att[p.home] ?? 0) - (def[p.away] ?? 0) + (modelo.beta || 0) * xElo + (modelo.gamma || 0) * xForma),
    lambdaAway: Math.exp(Math.log(base.muAway) + (att[p.away] ?? 0) - (def[p.home] ?? 0) - (modelo.beta || 0) * xElo - (modelo.gamma || 0) * xForma),
  };
}

module.exports = { entrenarConFeatures, lambdasExp };
