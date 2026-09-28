// ---------------------------------------------------------------------------
// EXPERIMENTAL — copia CONGELADA de services/prediccion/modelo_poisson.js (V1)
// con la estrategia de μ configurable para el experimento FASE 0 (V1 vs V1-LIGA).
//
// El modelo productivo V1 NO se modifica. `predecir` y `evaluar` se REUTILIZAN
// del módulo V1 (este entrenador produce exactamente la misma forma de modelo).
//
// Estrategias de μ (tasa base de goles local/visita por liga):
//   GLOBAL : μ global siempre (sin entrada por liga)
//   SPEC10 : μ de liga si n >= 10 en la muestra de ajuste; si no, global
//   SPEC30 : μ de liga si n >= 30  → IDÉNTICO a V1 (sanidad obligatoria)
//   BLEND30: μ = (n·μ_liga + 30·μ_global)/(n+30) para toda liga con n>=1
//            (regularización empírica: ligas pequeñas tienden al global)
//   FAMILY : μ de temporada si n>=30; si no, μ de la FAMILIA de liga
//            (nombre sin años/temporadas, n_fam>=30); si no, global.
//            Motivo: la clave de liga incluye la temporada, así que una liga
//            nueva ("La Liga 2026 2027") no hereda la historia de
//            "La Liga 2025 2026"; además hay duplicados con espacios
//            invisibles ("Bundesliga 2025 2026" ×2) que FAMILY normaliza.
// ---------------------------------------------------------------------------

function familia(liga) {
  return String(liga)
    .replace(/\u00A0/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b\d{2}\/\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function agregarPorClave(partidos, claveFn) {
  const m = new Map();
  for (const p of partidos) {
    const k = claveFn(p.liga);
    if (!m.has(k)) m.set(k, { n: 0, h: 0, a: 0 });
    const v = m.get(k);
    v.n += 1;
    v.h += p.goalsH;
    v.a += p.goalsA;
  }
  return m;
}

function calcularLigas(partidos, estrategia, kBlend = 30, minN = 30) {
  const sumH = partidos.reduce((a, p) => a + p.goalsH, 0);
  const sumA = partidos.reduce((a, p) => a + p.goalsA, 0);
  const muGlobal = { muHome: Math.max(sumH / partidos.length, 0.1), muAway: Math.max(sumA / partidos.length, 0.1) };

  const porTemporada = agregarPorClave(partidos, (l) => l); // clave exacta, como V1

  if (estrategia === "GLOBAL") return { ligas: {}, muGlobal };

  if (estrategia === "SPEC10" || estrategia === "SPEC30") {
    const min = estrategia === "SPEC10" ? 10 : minN;
    const ligas = {};
    for (const [liga, v] of porTemporada) {
      if (v.n >= min) ligas[liga] = { n: v.n, muHome: Math.max(v.h / v.n, 0.1), muAway: Math.max(v.a / v.n, 0.1) };
    }
    return { ligas, muGlobal };
  }

  if (estrategia === "BLEND30") {
    const ligas = {};
    for (const [liga, v] of porTemporada) {
      if (v.n < 1) continue;
      ligas[liga] = {
        n: v.n,
        muHome: Math.max((v.h + kBlend * muGlobal.muHome) / (v.n + kBlend), 0.1),
        muAway: Math.max((v.a + kBlend * muGlobal.muAway) / (v.n + kBlend), 0.1),
      };
    }
    return { ligas, muGlobal };
  }

  if (estrategia === "FAMILY") {
    const porFamilia = agregarPorClave(partidos, familia);
    const ligas = {};
    for (const [liga, v] of porTemporada) {
      if (v.n >= 30) {
        ligas[liga] = { n: v.n, muHome: Math.max(v.h / v.n, 0.1), muAway: Math.max(v.a / v.n, 0.1), origen: "temporada" };
      } else {
        const f = porFamilia.get(familia(liga));
        if (f && f.n >= 30) {
          ligas[liga] = { n: f.n, muHome: Math.max(f.h / f.n, 0.1), muAway: Math.max(f.a / f.n, 0.1), origen: "familia" };
        }
        // si tampoco hay familia con n>=30 → sin entrada → μ global
      }
    }
    return { ligas, muGlobal };
  }

  throw new Error("Estrategia desconocida: " + estrategia);
}

// --- de aquí en adelante: idéntico a V1 salvo por la fuente de `ligas` ---
const EPS = 1e-9;
const logLik = (y, lambda) => y * Math.log(lambda + EPS) - lambda;

function lambdasCon(ligas, muGlobal, liga, att, def, home, away) {
  const base = ligas[liga] || muGlobal;
  const aH = att.get ? att.get(home) : (att[home] ?? 0);
  const dH = def.get ? def.get(home) : (def[home] ?? 0);
  const aA = att.get ? att.get(away) : (att[away] ?? 0);
  const dA = def.get ? def.get(away) : (def[away] ?? 0);
  return {
    lambdaHome: Math.exp(Math.log(base.muHome) + aH - dA),
    lambdaAway: Math.exp(Math.log(base.muAway) + aA - dH),
  };
}

function entrenarExp(partidos, estrategia, opciones = {}) {
  const { epochs = 400, lrInicial = 0.05, l2 = 0.05 } = opciones;
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
      const lh = Math.exp(Math.log(base.muHome) + att.get(p.home) - def.get(p.away));
      const la = Math.exp(Math.log(base.muAway) + att.get(p.away) - def.get(p.home));
      const gH = p.goalsH - lh;
      const gA = p.goalsA - la;
      att.set(p.home, att.get(p.home) + lr * (gH - l2 * att.get(p.home)));
      def.set(p.away, def.get(p.away) + lr * (-gH - l2 * def.get(p.away)));
      att.set(p.away, att.get(p.away) + lr * (gA - l2 * att.get(p.away)));
      def.set(p.home, def.get(p.home) + lr * (-gA - l2 * def.get(p.home)));
    }
    lr *= 0.995;
  }

  let ll = 0;
  for (const p of partidos) {
    const { lambdaHome, lambdaAway } = lambdasCon(ligas, muGlobal, p.liga, att, def, p.home, p.away);
    ll += logLik(p.goalsH, lambdaHome) + logLik(p.goalsA, lambdaAway);
  }

  return {
    tipo: "poisson",
    version: "1.0-exp-mu-" + estrategia,
    muHomeGlobal: muGlobal.muHome,
    muAwayGlobal: muGlobal.muAway,
    ligas,
    att: Object.fromEntries(att),
    def: Object.fromEntries(def),
    entrenamiento: {
      partidos: partidos.length,
      equipos: att.size,
      ligasConParametros: Object.keys(ligas).length,
      logLikPromedio: Math.round((ll / partidos.length) * 1000) / 1000,
      hiperparametros: { epochs, lrInicial, l2, estrategia },
    },
  };
}

module.exports = { entrenarExp, calcularLigas, familia };
