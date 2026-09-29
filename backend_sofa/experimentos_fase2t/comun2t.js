// ---------------------------------------------------------------------------
// COMUN 2T — dataset y utilidades para el backtest del modelo de proyección 2T
// (Fase "modelo análisis 2T" de la sección Predicción).
//
// Fuentes (sólo DB local, cero datos externos):
//  - partidos: cabecera, goles 1T/FT (=> pseudo-stat "Goles" con 1T y 2T).
//  - estadisticas: valores por periodo 1ST/2ND de ~40 stats candidatas.
//
// Reglas del dataset:
//  - Base: partidos con fecha, goles 1T y FT conocidos y con "Total shots"
//    presente en 1ST y 2ND (muestra ~1.926, 2019-2026).
//  - Cada stat exige además su presencia en 1ST (features) y 2ND (label)
//    para entrar en la evaluación de ese stat (n varía por stat).
//  - Splits temporales: TRAIN 70% / VAL 15% / TEST 15% por fecha ascendente.
//    El TEST no se toca hasta la decisión final (convención del proyecto).
// ---------------------------------------------------------------------------
const pool = require("../db");

// Stats candidatas (nombre exacto en DB) con >=800 partidos en 1ST y 2ND.
const STATS = [
  "Accurate passes", "Aerial duels", "Ball possession", "Big chances",
  "Big chances missed", "Big chances scored", "Blocked shots", "Clearances",
  "Corner kicks", "Crosses", "Dispossessed", "Dribbles", "Duels",
  "Expected goals", "Expected goals on target", "Final third entries",
  "Fouled in final third", "Fouls", "Free kicks", "Goal kicks",
  "Goalkeeper saves", "Ground duels", "Hit woodwork", "Interceptions",
  "Long balls", "Offsides", "Passes", "Recoveries", "Shots inside box",
  "Shots off target", "Shots on target", "Shots outside box", "Tackles",
  "Tackles won", "Through balls", "Throw-ins", "Total saves", "Total shots",
  "Total tackles", "Yellow cards",
];
const GOLES = "Goles";
const TODOS = [GOLES, ...STATS];

// Principales (las que el usuario pide destacar).
const PRINCIPALES = [GOLES, "Total shots", "Corner kicks", "Yellow cards"];

const ETIQUETAS = {
  [GOLES]: "Goles",
  "Total shots": "Remates",
  "Corner kicks": "Corners",
  "Yellow cards": "Amarillas",
  "Expected goals": "xG",
  "Shots on target": "Remates al arco",
  "Fouls": "Faltas",
  "Ball possession": "Posesión %",
  "Passes": "Pases",
  "Red cards": "Rojas",
};
function etiqueta(stat) {
  return ETIQUETAS[stat] || stat;
}

// Familia de liga: trim + colapso de espacios (hay duplicados con espacio final
// como "Bundesliga 2025 2026 "). Se usa para los priors de liga.
function familiaLiga(liga) {
  if (!liga) return "General";
  return String(liga).replace(/\s+/g, " ").trim();
}
// Liga base: familia sin temporadas ("Serie A 2025 2026" -> "Serie A",
// "UEFA Nations League 26/27" -> "UEFA Nations League"). Conserva
// Apertura/Clausura/Dos (NO se fusionan divisiones distintas).
function baseLiga(liga) {
  return familiaLiga(liga)
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b\d{2}\/\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "General";
}

function media(arr) {
  if (!arr.length) return null;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

// Shrinkage empirical-Bayes: (n*media + c*prior)/(n+c)
function encoger(mediaHija, n, prior, c) {
  if (n <= 0) return prior;
  return (n * mediaHija + c * prior) / (n + c);
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------
async function cargarDataset() {
  const base = await pool.query(`
    SELECT p.id, p.equipo_local, p.equipo_visitante,
           p.fecha_partido::text AS fecha,
           p.liga, p.fecha_jornada,
           p.goles_local, p.goles_visitante,
           p.goles_local_1t, p.goles_visitante_1t
    FROM partidos p
    WHERE p.fecha_partido IS NOT NULL
      AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
      AND p.goles_local_1t IS NOT NULL AND p.goles_visitante_1t IS NOT NULL
      AND EXISTS (SELECT 1 FROM estadisticas e
                    WHERE e.partido_id = p.id AND e.periodo = '1ST'
                      AND e.nombre = 'Total shots' AND e.valor_local_num IS NOT NULL)
      AND EXISTS (SELECT 1 FROM estadisticas e
                    WHERE e.partido_id = p.id AND e.periodo = '2ND'
                      AND e.nombre = 'Total shots' AND e.valor_local_num IS NOT NULL)
    ORDER BY p.fecha_partido, p.id`);

  const stats = await pool.query(`
    SELECT partido_id, nombre, periodo,
           max(valor_local_num)::float    AS l,
           max(valor_visitante_num)::float AS a
    FROM estadisticas
    WHERE periodo IN ('1ST','2ND')
      AND nombre = ANY($1)
      AND valor_local_num IS NOT NULL
      AND valor_visitante_num IS NOT NULL
    GROUP BY 1,2,3`, [STATS]);

  const porPartido = new Map();
  for (const r of stats.rows) {
    const key = String(r.partido_id);
    if (!porPartido.has(key)) porPartido.set(key, {});
    const porNombre = porPartido.get(key);
    if (!porNombre[r.nombre]) porNombre[r.nombre] = {};
    porNombre[r.nombre][r.periodo] = { l: Number(r.l), a: Number(r.a) };
  }

  const partidos = [];
  for (const r of base.rows) {
    const ms = Date.parse(r.fecha);
    const st = porPartido.get(String(r.id)) || {};
    // Pseudo-stat Goles desde la cabecera.
    st[GOLES] = {
      "1ST": { l: Number(r.goles_local_1t), a: Number(r.goles_visitante_1t) },
      "2ND": {
        l: Number(r.goles_local) - Number(r.goles_local_1t),
        a: Number(r.goles_visitante) - Number(r.goles_visitante_1t),
      },
    };
    partidos.push({
      id: String(r.id),
      fecha: r.fecha,
      ms,
      liga: r.liga,
      familia: familiaLiga(r.liga),
      base: baseLiga(r.liga),
      local: r.equipo_local,
      visitante: r.equipo_visitante,
      g: {
        hl: Number(r.goles_local_1t), ha: Number(r.goles_visitante_1t),
        fl: Number(r.goles_local), fa: Number(r.goles_visitante),
      },
      stats: st,
    });
  }
  return partidos;
}

// Splits temporales TRAIN 70 / VAL 15 / TEST 15 (por fecha ascendente).
function partirSplits(partidos) {
  const n = partidos.length;
  const iVal = Math.floor(n * 0.7);
  const iTest = Math.floor(n * 0.85);
  const idx = (i) => (i <= iVal ? "TRAIN" : i <= iTest ? "VAL" : "TEST");
  const counts = { TRAIN: 0, VAL: 0, TEST: 0 };
  partidos.forEach((p, i) => { p.split = idx(i); counts[p.split]++; });
  const rango = (s) => {
    const xs = partidos.filter((p) => p.split === s);
    return { n: xs.length, desde: xs[0]?.fecha, hasta: xs[xs.length - 1]?.fecha };
  };
  return { counts, TRAIN: rango("TRAIN"), VAL: rango("VAL"), TEST: rango("TEST") };
}

// ---------------------------------------------------------------------------
// Ridge (mínimos cuadrados con regularización, intercepto sin penalizar).
// X: filas estandarizadas YA (sin columna de 1s); w incluye intercepto al final.
// ---------------------------------------------------------------------------
function ridgeFit(X, y, alpha) {
  const n = X.length;
  if (!n) return null;
  const p = X[0].length;
  // Estandarización
  const mu = new Array(p).fill(0);
  const sd = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) mu[j] += X[i][j];
    mu[j] /= n;
    for (let i = 0; i < n; i++) sd[j] += (X[i][j] - mu[j]) ** 2;
    sd[j] = Math.sqrt(sd[j] / n) || 1;
  }
  const Z = X.map((row) => row.map((v, j) => (v - mu[j]) / sd[j]));
  // XtX (p+1)x(p+1) con intercepto
  const d = p + 1;
  const A = Array.from({ length: d }, () => new Array(d).fill(0));
  const b = new Array(d).fill(0);
  for (let i = 0; i < n; i++) {
    const z = Z[i];
    const zi = [1, ...z];
    const yv = y[i];
    for (let a = 0; a < d; a++) {
      b[a] += zi[a] * yv;
      for (let c = 0; c < d; c++) A[a][c] += zi[a] * zi[c];
    }
  }
  for (let a = 1; a < d; a++) A[a][a] += alpha;
  const w = resolverSistema(A, b);
  if (!w) return null;
  return { mu, sd, w };
}

function resolverSistema(A, b) {
  const n = b.length;
  const M = A.map((fila, i) => [...fila, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let f = col + 1; f < n; f++) if (Math.abs(M[f][col]) > Math.abs(M[piv][col])) piv = f;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let f = 0; f < n; f++) {
      if (f === col) continue;
      const factor = M[f][col];
      if (!factor) continue;
      for (let c = col; c <= n; c++) M[f][c] -= factor * M[col][c];
    }
  }
  return M.map((fila) => fila[n]);
}

function ridgePredecir(modelo, x) {
  const z = x.map((v, j) => (v - modelo.mu[j]) / modelo.sd[j]);
  let y = modelo.w[0];
  for (let j = 0; j < z.length; j++) y += modelo.w[j + 1] * z[j];
  return y;
}

// ---------------------------------------------------------------------------
// Heurística H — port fiel de AnalisisProyeccion.jsx (Proyección 2T actual).
// Compartida por el backtest (fase2t_0) y el servicio en vivo (modelo_2t).
// ---------------------------------------------------------------------------
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const ratioF = (x, y) => (y === 0 ? x : x / y);

function similitudRemates(cand, tx, ty) {
  if (!cand.length) return [];
  const tr = ratioF(tx, ty);
  const exactos = cand.filter((c) => Math.abs(ratioF(c.rOwn1T, c.rRiv1T) - tr) < 0.01);
  if (exactos.length) return exactos;
  const conDist = cand.map((c) => ({ c, d: Math.abs(c.rOwn1T - tx) + Math.abs(c.rRiv1T - ty) }));
  const min = Math.min(...conDist.map((x) => x.d));
  return conDist.filter((x) => x.d <= min + 2).map((x) => x.c);
}

function similitudCorners(cand, tx, ty) {
  if (!cand.length) return [];
  const tr = ratioF(tx, ty);
  const exactos = cand.filter((c) => Math.abs(ratioF(c.cOwn1T, c.cRiv1T) - tr) < 0.01);
  if (exactos.length) return exactos;
  const tSum = tx + ty;
  const dist = cand.map((c) => ({ c, sum: c.cOwn1T + c.cRiv1T }));
  const minSum = Math.min(...dist.map((x) => Math.abs(x.sum - tSum)));
  return dist.filter((x) => Math.abs(x.sum - tSum) === minSum).map((x) => x.c);
}

// Registro de historial (lado X = equipo propio).
function registro(m) {
  const s = (n, p) => (m.stats[n] && m.stats[n][p]) || null;
  const r1 = s("Total shots", "1ST"), r2 = s("Total shots", "2ND");
  const c1 = s("Corner kicks", "1ST"), c2 = s("Corner kicks", "2ND");
  return {
    ms: m.ms, fecha: m.fecha, local: m.local, visitante: m.visitante,
    gOwn1T: m.g.hl, gRiv1T: m.g.ha, gOwn2T: m.g.fl - m.g.hl, gRiv2T: m.g.fa - m.g.ha,
    rOwn1T: r1 ? num(r1.l) : 0, rRiv1T: r1 ? num(r1.a) : 0,
    rOwn2T: r2 ? num(r2.l) : 0,
    cOwn1T: c1 ? num(c1.l) : 0, cRiv1T: c1 ? num(c1.a) : 0,
    cOwn2T: c2 ? num(c2.l) : 0,
  };
}

// Registro del bando visitante (espejo).
function registroVisita(m) {
  const r = registro(m);
  const t2 = (m.stats["Total shots"] || {})["2ND"] || null;
  const k2 = (m.stats["Corner kicks"] || {})["2ND"] || null;
  return {
    ...r,
    gOwn1T: m.g.ha, gRiv1T: m.g.hl, gOwn2T: m.g.fa - m.g.ha, gRiv2T: m.g.fl - m.g.hl,
    rOwn1T: r.rRiv1T, rRiv1T: r.rOwn1T, rOwn2T: t2 ? num(t2.a) : 0,
    cOwn1T: r.cRiv1T, cRiv1T: r.cOwn1T, cOwn2T: k2 ? num(k2.a) : 0,
  };
}

// Predicciones H para home y away de un partido (usa sólo el 1T actual).
function predecirH(m, histH, histA, globalGoles) {
  const f = (e) => e.ms < m.ms;
  const allH = histH.filter(f), allA = histA.filter(f);
  const gH = m.g.hl, gA = m.g.ha;
  const resH = allH.filter((e) => e.gOwn1T === gH), resA = allA.filter((e) => e.gOwn1T === gA);
  const filH = resH.filter((e) => e.gRiv1T === gA), filA = resA.filter((e) => e.gRiv1T === gH);

  // Goles: combinado como en el Excel/front (X propio + rivales del otro lado).
  const goles = (lado) => {
    const propio = lado === "home" ? [filH, resH, allH] : [filA, resA, allA];
    const cruz = lado === "home" ? [filA, resA, allA] : [filH, resH, allH];
    const niveles = ["fil", "res", "all"];
    for (let i = 0; i < 3; i++) {
      const pool = [...propio[i].map((e) => e.gOwn2T), ...cruz[i].map((e) => e.gRiv2T)];
      if (pool.length) return { v: media(pool), nivel: niveles[i], n: pool.length };
    }
    return { v: globalGoles.v, nivel: "global", n: globalGoles.n };
  };

  const seleccion = (lado, tipo) => {
    const t1s = (m.stats["Total shots"] || {})["1ST"] || { l: 0, a: 0 };
    const c1s = (m.stats["Corner kicks"] || {})["1ST"] || { l: 0, a: 0 };
    const tx = lado === "home" ? num(t1s.l) : num(t1s.a);
    const ty = lado === "home" ? num(t1s.a) : num(t1s.l);
    const cx = lado === "home" ? num(c1s.l) : num(c1s.a);
    const cy = lado === "home" ? num(c1s.a) : num(c1s.l);
    const propio = lado === "home" ? [filH, resH, allH] : [filA, resA, allA];
    const niveles = ["fil", "res", "all"];
    for (let i = 0; i < 3; i++) {
      if (!propio[i].length) continue;
      const sel = tipo === "rem"
        ? similitudRemates(propio[i], tx, ty)
        : similitudCorners(propio[i], cx, cy);
      if (sel.length) {
        const vals = sel.map((e) => (tipo === "rem" ? e.rOwn2T : e.cOwn2T));
        return { v: media(vals), nivel: niveles[i], n: vals.length };
      }
    }
    return null;
  };

  const out = {};
  for (const lado of ["home", "away"]) {
    const g = goles(lado);
    const r = seleccion(lado, "rem");
    const c = seleccion(lado, "corn");
    out[lado] = {
      goles: g,
      remates: r || { v: 0, nivel: "nada", n: 0 },
      corners: c || { v: 0, nivel: "nada", n: 0 },
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Features por stat (paso expansivo con cutoff estricto). Compartido por
// backtest, script de entrenamiento y el servicio en vivo (modelo_2t).
// ---------------------------------------------------------------------------
const N_FEATURES = 11;
const K_GEN = 15, K_COND = 10, SHRINK_C = 6, LIGA_MIN = 10;

// h  = historial del equipo propio (entries con cutoff YA aplicado)
// hR = historial del rival    (entries con cutoff YA aplicado)
// entry = {ms, t1, t2, rivT2, cond:'home'|'away'}
function featuresLado({ h, hR, own1t, opp1t, stateLado, lado, l2T, l1T }) {
  const conT2 = h.filter((e) => e.t2 !== null);
  const conT1 = h.filter((e) => e.t1 !== null);
  const condT2 = conT2.filter((e) => e.cond === lado);

  const poolGen = conT2.slice(-K_GEN);
  const poolCond = condT2.slice(-K_COND);
  const usarCond = poolCond.length >= 4;
  const pool = usarCond ? poolCond : poolGen;
  const team2T = pool.length ? encoger(media(pool.map((e) => e.t2)), pool.length, l2T, SHRINK_C) : l2T;
  const team2Tgen = poolGen.length ? encoger(media(poolGen.map((e) => e.t2)), poolGen.length, l2T, SHRINK_C) : l2T;
  const pT1 = conT1.slice(-K_GEN);
  const team1T = pT1.length ? encoger(media(pT1.map((e) => e.t1)), pT1.length, l1T, SHRINK_C) : l1T;

  const oppT2v = (hR || []).filter((e) => e.t2 !== null).slice(-K_GEN);
  const opp2T = oppT2v.length ? encoger(media(oppT2v.map((e) => e.t2)), oppT2v.length, l2T, SHRINK_C) : l2T;
  const conced = conT2.map((e) => e.rivT2).filter((v) => v !== null).slice(-K_GEN);
  const conced2T = conced.length ? encoger(media(conced), conced.length, l2T, SHRINK_C) : l2T;

  const pace = (own1t + 0.5) / (team1T + 1);

  return {
    feats: [
      own1t, opp1t, stateLado,
      team2T, team2Tgen, team1T,
      opp2T, conced2T, l2T,
      lado === "home" ? 1 : 0,
      pace,
    ],
    T: team2T, L0: l2T, nHist: pool.length,
  };
}

function construirFilas(partidos, stat) {
  const teamHist = new Map(); // equipo -> [{ms,t1,t2,rivT2,cond}]
  const fam = new Map(), base = new Map();
  let glob = { n2: 0, s2: 0, n1: 0, s1: 0 };

  const promedio = (obj) => (obj.n2 ? obj.s2 / obj.n2 : null);
  const league = (m) => {
    const lf = fam.get(m.familia);
    if (lf && lf.n2 >= LIGA_MIN) return promedio(lf);
    const lb = base.get(m.base);
    if (lb && lb.n2 >= LIGA_MIN) return promedio(lb);
    return glob.n2 ? glob.s2 / glob.n2 : 0;
  };
  const league1 = (m) => {
    const lf = fam.get(m.familia);
    if (lf && lf.n1 >= LIGA_MIN) return lf.s1 / lf.n1;
    const lb = base.get(m.base);
    if (lb && lb.n1 >= LIGA_MIN) return lb.s1 / lb.n1;
    return glob.n1 ? glob.s1 / glob.n1 : 0;
  };

  const filas = [];

  for (const m of partidos) {
    const st = m.stats[stat];
    const t1 = st && st["1ST"], t2 = st && st["2ND"];
    const l2T = league(m), l1T = league1(m);

    for (const lado of ["home", "away"]) {
      const eq = lado === "home" ? m.local : m.visitante;
      const riv = lado === "home" ? m.visitante : m.local;
      const own1t = t1 ? (lado === "home" ? t1.l : t1.a) : null;
      const opp1t = t1 ? (lado === "home" ? t1.a : t1.l) : null;
      const label = t2 ? (lado === "home" ? t2.l : t2.a) : null;
      if (own1t === null || label === null) continue; // R1: features requieren 1T, label 2T

      const h = (teamHist.get(eq) || []).filter((e) => e.ms < m.ms);
      const hR = (teamHist.get(riv) || []).filter((e) => e.ms < m.ms);
      const state = m.g.hl - m.g.ha;
      const f = featuresLado({
        h, hR, own1t, opp1t,
        stateLado: lado === "home" ? state : -state,
        lado, l2T, l1T,
      });
      filas.push({ m, lado, eq, label, ...f });
    }

    // Actualización expansiva DESPUÉS de evaluar el partido (sin leakage).
    const upd = (eq) => {
      const arr = teamHist.get(eq) || [];
      arr.push({
        ms: m.ms,
        t1: t1 ? t1.l : null, t2: t2 ? t2.l : null,
        rivT2: t2 ? t2.a : null, cond: "home",
      });
      teamHist.set(eq, arr);
    };
    const updV = (eq) => {
      const arr = teamHist.get(eq) || [];
      arr.push({
        ms: m.ms,
        t1: t1 ? t1.a : null, t2: t2 ? t2.a : null,
        rivT2: t2 ? t2.l : null, cond: "away",
      });
      teamHist.set(eq, arr);
    };
    // (equipo local se evalúa con cond "home" — corregir cond arriba:)
    if (t2) {
      const f = fam.get(m.familia) || { n2: 0, s2: 0, n1: 0, s1: 0 };
      f.n2++; f.s2 += (t2.l + t2.a) / 2; // media de liga por partido (media de ambos lados)
      if (t1) { f.n1++; f.s1 += (t1.l + t1.a) / 2; }
      fam.set(m.familia, f);
      const b = base.get(m.base) || { n2: 0, s2: 0, n1: 0, s1: 0 };
      b.n2++; b.s2 += (t2.l + t2.a) / 2;
      if (t1) { b.n1++; b.s1 += (t1.l + t1.a) / 2; }
      base.set(m.base, b);
      glob.n2++; glob.s2 += (t2.l + t2.a) / 2;
      if (t1) { glob.n1++; glob.s1 += (t1.l + t1.a) / 2; }
    }
    upd(m.local); updV(m.visitante);
    // corrige cond de la entrada recién agregada del local (upd usa cond home ✓)
    const arrL = teamHist.get(m.local);
    arrL[arrL.length - 1].cond = "home";
    const arrV = teamHist.get(m.visitante);
    arrV[arrV.length - 1].cond = "away";
  }
  return filas;
}

module.exports = {
  STATS, GOLES, TODOS, PRINCIPALES,
  etiqueta, familiaLiga, baseLiga,
  media, encoger, cargarDataset, partirSplits,
  ridgeFit, ridgePredecir,
  similitudRemates, similitudCorners, registro, registroVisita, predecirH,
  construirFilas, featuresLado,
  K_GEN, K_COND, SHRINK_C, LIGA_MIN, N_FEATURES,
};
