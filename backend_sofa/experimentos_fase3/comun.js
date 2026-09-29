// ---------------------------------------------------------------------------
// FASE 3 — Infraestructura compartida (diagnóstico, errores, experimentos A–G).
//
// REGLAS DE ORO:
//  - Solo TRAIN+VAL. El TEST jamás se carga (SQL filtra fecha <= fin de VAL).
//  - Splits = fechas oficiales registradas en modelos/prediccion_poisson.json
//    (no se recalculan por conteo: el dataset puede crecer con subidas nuevas).
//  - Ventanas rolling idénticas (día estricto) a fase_elo/fase_stats.
//  - Sin leakage: toda feature histórica usa solo partidos ANTERIORES.
//  - Este código es EXCLUSIVO de investigación: V1_BETA (producción) no lo usa
//    y ningún archivo de experimentos/, services/prediccion/ ni modelos/ se
//    modifica. Copias mínimas de utilidades están marcadas "copia de X".
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");

const CLASES = ["home", "draw", "away"];
const r4 = (x) => Math.round(x * 10000) / 10000;
const pct = (x, d = 2) => (x * 100).toFixed(d) + "%";
const argmax = (p) => CLASES.reduce((a, b) => (p[a] >= p[b] ? a : b));
const realDe = (p) => (p.goalsH > p.goalsA ? "home" : p.goalsH === p.goalsA ? "draw" : "away");

// Mismo día que usaron las fases previas (toISOString; la máquina está en UTC-5,
// la medianoche local queda en el mismo día ISO). Idéntico a fase_elo.js:129.
const dia = (m) => new Date(m.fecha).toISOString().slice(0, 10);

const modeloJson = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8"));

// Reparte una lista YA filtrada a ≤ fin de VAL por las fechas oficiales del
// split (contrae drift si el dataset cambió desde el modelo oficial).
function partirTV(partidos) {
  const m = modeloJson();
  const trainHasta = m.backtest.split.train.hasta.slice(0, 10); // 2026-05-02
  const valHasta = m.backtest.split.val.hasta.slice(0, 10);     // 2026-06-18
  const train = partidos.filter((p) => dia(p) <= trainHasta);
  const val = partidos.filter((p) => dia(p) > trainHasta && dia(p) <= valHasta);
  const TV = [...train, ...val];
  const nExpEsperado = m.backtest.split.train.n, nValEsperado = m.backtest.split.val.n;
  if (train.length !== nExpEsperado || val.length !== nValEsperado) {
    throw new Error(`DRIFT DE DATOS: TRAIN ${train.length}/${nExpEsperado}, VAL ${val.length}/${nValEsperado} — el dataset cambió desde el modelo oficial; detener y revisar.`);
  }
  return { train, val, TV, nTrain: train.length, valHasta, trainHasta };
}

// Carga SOLO train+val (TEST fuera del SQL) y reparte por fechas oficiales.
async function cargarTV(pool) {
  const m = modeloJson();
  const valHasta = m.backtest.split.val.hasta.slice(0, 10);
  const { rows } = await pool.query(`
    SELECT id, fecha_partido, liga, equipo_local, equipo_visitante, goles_local, goles_visitante
    FROM partidos
    WHERE estado='Ended' AND fecha_partido IS NOT NULL
      AND goles_local IS NOT NULL AND goles_visitante IS NOT NULL
      AND fecha_partido <= '${valHasta}'
    ORDER BY fecha_partido ASC, id ASC;`);
  const partidos = rows.map((x) => ({
    id: x.id,
    fecha: x.fecha_partido, liga: x.liga, home: x.equipo_local, away: x.equipo_visitante,
    goalsH: x.goles_local, goalsA: x.goles_visitante,
  }));
  const { train, val, TV, nTrain, trainHasta } = partirTV(partidos);
  return { partidos, train, val, TV, nTrain, valHasta, trainHasta };
}

// Ventanas rolling día-estricto — copia byte-idéntica de fase_elo.js:129-141.
function construirVentanas(TV, nTrain) {
  const cortar = (arr, i) => {
    i = Math.max(1, Math.min(arr.length - 1, i));
    while (i < arr.length && dia(arr[i - 1]) === dia(arr[i])) i += 1;
    return i;
  };
  const fr = [0.5, 0.625, 0.75, 0.875, 1];
  const cortes = fr.map((f, idx) => (idx === fr.length - 1 ? TV.length : cortar(TV, Math.floor(TV.length * f))));
  const ventanas = [];
  for (let w = 0; w < 4; w++) {
    ventanas.push({ nombre: `W${w + 1}`, fit: TV.slice(0, cortes[w]), eval: TV.slice(cortes[w], cortes[w + 1]) });
  }
  const oficial = { nombre: "OFICIAL", fit: TV.slice(0, nTrain), eval: TV.slice(nTrain) };
  return { oficial, ventanas };
}

// Evaluación con λ explícitos (misma estructura que evaluarExp de fase_elo.js:23-35,
// ampliada con lambdaHome/lambdaAway para diagnóstico). Sin covariables en el
// modelo, xElo/xForma = 0 → idéntica a evaluar() de producción (sanidad en 3.1).
function evaluarExp(modelo, partidos) {
  const { probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");
  const { calcularMetricas } = require("../services/prediccion/backtest");
  const predicciones = partidos.map((p) => {
    const ligas = modelo.ligas || {};
    const base = ligas[p.liga] || { muHome: modelo.muHomeGlobal, muAway: modelo.muAwayGlobal };
    const att = modelo.att || {}, def = modelo.def || {};
    const xElo = modelo.conElo ? (p.eloHome - p.eloAway) / 400 : 0;
    const xForma = modelo.conForma ? (p.formaHome - p.formaAway) : 0;
    const lambdaHome = Math.exp(Math.log(base.muHome) + (att[p.home] ?? 0) - (def[p.away] ?? 0) + (modelo.beta || 0) * xElo + (modelo.gamma || 0) * xForma);
    const lambdaAway = Math.exp(Math.log(base.muAway) + (att[p.away] ?? 0) - (def[p.home] ?? 0) - (modelo.beta || 0) * xElo - (modelo.gamma || 0) * xForma);
    const { home, draw, away } = probsDesdeLambdas(lambdaHome, lambdaAway);
    return {
      fecha: p.fecha, id: p.id, home: p.home, away: p.away, liga: p.liga,
      lambdaHome, lambdaAway,
      probs: aPorcentajes(home, draw, away, 1),
      real: realDe(p),
      marcador: `${p.goalsH}-${p.goalsA}`,
    };
  });
  return { predicciones, metricas: calcularMetricas(predicciones) };
}

// Copia de fase_elo.js:62-82 (matriz confusión, recall/precision/F1, promedios).
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

// Copia de fase_stats.js:58-63 (LogLoss de un subconjunto, p.ej. solo empates).
function llSubconjunto(preds, clase) {
  const sub = preds.filter((x) => x.real === clase);
  if (!sub.length) return null;
  const ll = sub.reduce((a, x) => a - Math.log(Math.max(1e-15, x.probs[clase] / 100)), 0);
  return Math.round((ll / sub.length) * 10000) / 10000;
}

// Copia de fase_elo.js:40-60 (forma ≤5 previos, definición histórica usada en V3).
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

// Forma N partidos previos con corte DÍA ESTRICTO (para segmentos 3.1):
// puntos/(3N) de los últimos ≤N partidos con fecha < fecha del partido objetivo.
function calcularFormasN(tv, N) {
  const hist = new Map(); // equipo → [{dia, pts}]
  const antes = [];
  for (const p of tv) {
    const d = dia(p);
    const tasa = (eq) => {
      const arr = hist.get(eq) || [];
      const previos = arr.filter((x) => x.dia < d).slice(-N);
      if (!previos.length) return 0;
      return previos.reduce((a, x) => a + x.pts, 0) / (3 * previos.length);
    };
    antes.push({ home: tasa(p.home), away: tasa(p.away) });
    const pH = p.goalsH > p.goalsA ? 3 : p.goalsH === p.goalsA ? 1 : 0;
    const pA = p.goalsA > p.goalsH ? 3 : p.goalsA === p.goalsH ? 1 : 0;
    for (const [eq, r] of [[p.home, pH], [p.away, pA]]) {
      if (!hist.has(eq)) hist.set(eq, []);
      hist.get(eq).push({ dia: d, pts: r });
    }
  }
  return antes;
}

// Resumen de un segmento de items {m, pred}: métricas + distribuciones.
function resumenSegmento(preds, { calcularMetricas }) {
  if (!preds.length) return { n: 0 };
  const m = calcularMetricas(preds);
  const ext = extendidas(preds);
  const realCnt = { home: 0, draw: 0, away: 0 };
  for (const p of preds) realCnt[p.real]++;
  const n = preds.length;
  return {
    n,
    accuracy: r4(m.accuracy), logLoss: r4(m.logLoss), brier: r4(m.brier), ece: r4(m.ece),
    real: { home: r4(realCnt.home / n), draw: r4(realCnt.draw / n), away: r4(realCnt.away / n) },
    pred: { home: r4(ext.prom.home), draw: r4(ext.prom.draw), away: r4(ext.prom.away) },
    recall: Object.fromEntries(CLASES.map((c) => [c, ext.por[c].recall === null ? null : r4(ext.por[c].recall)])),
  };
}

function guardarInforme(nombre, obj) {
  const dir = path.join(__dirname, "informes");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, nombre);
  fs.writeFileSync(ruta, JSON.stringify(obj, null, 2));
  return ruta;
}

module.exports = {
  CLASES, r4, pct, argmax, realDe, dia, modeloJson,
  cargarTV, partirTV, construirVentanas, evaluarExp, extendidas, llSubconjunto,
  calcularFormas, calcularFormasN, resumenSegmento, guardarInforme,
};
