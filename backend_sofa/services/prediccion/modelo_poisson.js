// ---------------------------------------------------------------------------
// Modelo Poisson para 1X2 — FASE 1.
//
// λ_local  = μ_local(liga) · exp(att_local − def_visitante)
// λ_visitante = μ_visita(liga) · exp(att_visita − def_local)
//
// Todos los parámetros (μ, att, def) se ESTIMAN de la historia por máxima
// verosimilitud (descenso de gradiente sobre el log-verosimilitud de Poisson
// con regularización L2). No hay pesos ni reglas arbitrarias: son números
// ajustados a los partidos de entrenamiento.
//
// La interfaz es la misma que usarán en fase 2 otros modelos
// (regresión logística / boosting): entrenar(...) y predecir(...).
// ---------------------------------------------------------------------------

const EPS = 1e-9;
const K_MAX = 15; // colas de Poisson; P(>15) < 1e-6 incluso con λ≈3.5

// log-verosimilitud de Poisson (sin el término constante, que no afecta al argmax)
const logLik = (y, lambda) => y * Math.log(lambda + EPS) - lambda;

function poissonPmf(k, lambda) {
  // log P(X=k) = -λ + k·log(λ) - log(k!) = -λ + Σ_{i=1..k} [log(λ) - log(i)]
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda + EPS) - Math.log(i);
  return Math.exp(logP);
}

// Matriz conjunta de goles (independientes) → P(local), P(empate), P(visita)
function probsDesdeLambdas(lambdaH, lambdaA) {
  const pH = [];
  const pA = [];
  for (let k = 0; k <= K_MAX; k++) {
    pH.push(poissonPmf(k, lambdaH));
    pA.push(poissonPmf(k, lambdaA));
  }
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i <= K_MAX; i++) {
    for (let j = 0; j <= K_MAX; j++) {
      const p = pH[i] * pA[j];
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  }
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

// Redondeo con mayor resto: los 3 % suman 100.0 como DECIMALES exactos
// (enteros de décima que suman 1000). Además se garantiza que la suma en
// float IEEE (=== 100) sea estrictamente 100: como un múltiplo de 0.1 no es
// exacto en binario, ~9% de los casos daba 100±1.4e-14. En esos casos se
// transfiere 1 décima entre componentes (la suma decimal sigue siendo 100.0)
// hasta que `h + e + a === 100` sea true en JavaScript.
function aPorcentajes(home, draw, away, decimales = 1) {
  const f = 10 ** decimales;
  const exactos = [home, draw, away].map((p) => p * 100 * f);
  const base = exactos.map((v) => Math.floor(v));
  let sobrante = Math.round(100 * f) - base.reduce((a, b) => a + b, 0);
  const orden = exactos
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const res = [...base];
  for (let k = 0; sobrante > 0 && k < orden.length * 2; k++) {
    const idx = orden[k % orden.length].i;
    res[idx] += 1;
    sobrante -= 1;
  }

  const sumaFloat = () => res[0] / f + res[1] / f + res[2] / f;
  if (sumaFloat() !== 100) {
    const donantes = [...orden].reverse().map((o) => o.i); // menor resto primero
    const receptores = orden.map((o) => o.i);
    externo: for (const from of donantes) {
      for (const to of receptores) {
        if (from === to || res[from] <= 0) continue;
        res[from] -= 1;
        res[to] += 1;
        if (sumaFloat() === 100) break externo;
        res[from] += 1; // revertir y probar la siguiente transferencia
        res[to] -= 1;
      }
    }
  }

  return {
    home: res[0] / f,
    draw: res[1] / f,
    away: res[2] / f,
  };
}

// ---------------------------------------------------------------------------
// ENTRENAMIENTO (solo con los partidos que se le pasan → el llamador controla
// la fecha de corte y así se evita data leakage).
// ---------------------------------------------------------------------------
// partidos: [{ home, away, goalsH, goalsA, liga }]
function entrenar(partidos, opciones = {}) {
  const {
    epochs = 400,
    lrInicial = 0.05,
    l2 = 0.05,
    minPartidosLiga = 30,
  } = opciones;

  if (!partidos.length) throw new Error("No hay partidos para entrenar");

  const att = new Map();
  const def = new Map();

  // Tasas base: global y por liga (si hay volumen suficiente).
  let sumH = 0;
  let sumA = 0;
  const porLiga = new Map();
  for (const p of partidos) {
    sumH += p.goalsH;
    sumA += p.goalsA;
    if (!porLiga.has(p.liga)) porLiga.set(p.liga, { n: 0, h: 0, a: 0 });
    const l = porLiga.get(p.liga);
    l.n += 1;
    l.h += p.goalsH;
    l.a += p.goalsA;
    if (!att.has(p.home)) att.set(p.home, 0);
    if (!att.has(p.away)) att.set(p.away, 0);
    if (!def.has(p.home)) def.set(p.home, 0);
    if (!def.has(p.away)) def.set(p.away, 0);
  }

  const muHomeGlobal = Math.max(sumH / partidos.length, 0.1);
  const muAwayGlobal = Math.max(sumA / partidos.length, 0.1);

  const ligas = {};
  for (const [liga, v] of porLiga) {
    if (v.n >= minPartidosLiga) {
      ligas[liga] = {
        n: v.n,
        muHome: Math.max(v.h / v.n, 0.1),
        muAway: Math.max(v.a / v.n, 0.1),
      };
    }
  }

  const mu = (liga) => ligas[liga] || { muHome: muHomeGlobal, muAway: muAwayGlobal };

  // Descenso de gradiente sobre att/def (μ fija, estimada de medias).
  const orden = [...partidos.keys()];
  let lr = lrInicial;
  for (let epoch = 0; epoch < epochs; epoch++) {
    // shuffle determinista para que el entrenamiento sea reproducible
    for (let i = orden.length - 1; i > 0; i--) {
      const j = (i * 1103515245 + 12345 + epoch * 2654435761) % (i + 1);
      [orden[i], orden[j]] = [orden[j], orden[i]];
    }
    for (const idx of orden) {
      const p = partidos[idx];
      const base = mu(p.liga);
      const lh = Math.exp(Math.log(base.muHome) + att.get(p.home) - def.get(p.away));
      const la = Math.exp(Math.log(base.muAway) + att.get(p.away) - def.get(p.home));

      const gH = p.goalsH - lh; // ∂ℓ/∂att_local  (y −λ); ∂ℓ/∂def_visita = −(y−λ)
      const gA = p.goalsA - la;

      att.set(p.home, att.get(p.home) + lr * (gH - l2 * att.get(p.home)));
      def.set(p.away, def.get(p.away) + lr * (-gH - l2 * def.get(p.away)));
      att.set(p.away, att.get(p.away) + lr * (gA - l2 * att.get(p.away)));
      def.set(p.home, def.get(p.home) + lr * (-gA - l2 * def.get(p.home)));
    }
    lr *= 0.995;
  }

  // Verosimilitud de diagnóstico sobre la muestra de entrenamiento
  let ll = 0;
  for (const p of partidos) {
    const { lambdaHome, lambdaAway } = lambdasCon(base => mu(base), p.liga, att, def, p.home, p.away);
    ll += logLik(p.goalsH, lambdaHome) + logLik(p.goalsA, lambdaAway);
  }

  return {
    tipo: "poisson",
    version: "1.0",
    muHomeGlobal,
    muAwayGlobal,
    ligas,
    att: Object.fromEntries(att),
    def: Object.fromEntries(def),
    entrenamiento: {
      partidos: partidos.length,
      equipos: att.size,
      ligasConParametros: Object.keys(ligas).length,
      logLikPromedio: Math.round((ll / partidos.length) * 1000) / 1000,
      hiperparametros: { epochs, lrInicial, l2, minPartidosLiga },
    },
  };
}

function lambdasCon(muFn, liga, att, def, home, away) {
  const base = muFn(liga);
  const aH = att.get ? att.get(home) : (att[home] ?? 0);
  const dH = def.get ? def.get(home) : (def[home] ?? 0);
  const aA = att.get ? att.get(away) : (att[away] ?? 0);
  const dA = def.get ? def.get(away) : (def[away] ?? 0);
  return {
    lambdaHome: Math.exp(Math.log(base.muHome) + aH - dA),
    lambdaAway: Math.exp(Math.log(base.muAway) + aA - dH),
  };
}

// ---------------------------------------------------------------------------
// PREDICCIÓN con un modelo ya entrenado (parámetros cargados del JSON).
// ---------------------------------------------------------------------------
function predecir(modelo, { home, away, liga }) {
  const att = modelo.att || {};
  const def = modelo.def || {};
  const ligas = modelo.ligas || {};

  // Tasa base: de la liga si el modelo tiene parámetros para ella, si no global.
  let muH = modelo.muHomeGlobal;
  let muA = modelo.muAwayGlobal;
  const usaLigaEspecifica = Boolean(liga && ligas[liga]);
  if (usaLigaEspecifica) {
    muH = ligas[liga].muHome;
    muA = ligas[liga].muAway;
  }

  const aH = att[home] ?? 0;
  const dH = def[home] ?? 0;
  const aA = att[away] ?? 0;
  const dA = def[away] ?? 0;

  const lambdaHome = Math.exp(Math.log(muH) + aH - dA);
  const lambdaAway = Math.exp(Math.log(muA) + aA - dH);

  const { home: pH, draw: pD, away: pA } = probsDesdeLambdas(lambdaHome, lambdaAway);
  const pct = aPorcentajes(pH, pD, pA, 1);

  return {
    probabilities: pct,
    internos: {
      lambdaHome: Math.round(lambdaHome * 1000) / 1000,
      lambdaAway: Math.round(lambdaAway * 1000) / 1000,
      muHome: Math.round(muH * 1000) / 1000,
      muAway: Math.round(muA * 1000) / 1000,
      usaLigaEspecifica,
      attHome: Math.round(aH * 1000) / 1000,
      defHome: Math.round(dH * 1000) / 1000,
      attAway: Math.round(aA * 1000) / 1000,
      defAway: Math.round(dA * 1000) / 1000,
      equipoLocalSinHistorial: !(home in att),
      equipoVisitanteSinHistorial: !(away in att),
    },
  };
}

module.exports = { entrenar, predecir, probsDesdeLambdas, aPorcentajes };
