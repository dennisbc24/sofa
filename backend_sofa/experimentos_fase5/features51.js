// ---------------------------------------------------------------------------
// FASE 5.1 — Features históricas para NUEVAS stats (copia adaptada de
// experimentos/stats_features.js — archivo PROTEGIDO, no se modifica).
//
// Mismas garantías que la infra previa:
//   - DÍA ESTRICTO: las features del día D se calculan con el estado al
//     INICIO de D (sólo partidos con fecha < D); el día se ingiere después
//     de predecir todos sus partidos.
//   - 1T+2T si existen ambos periodos, si no ALL (evita prórroga cuando hay split).
//   - NULL = AUSENTE (nunca 0). Ceros = reales (estas 6 stats no son
//     xG-like: ceros 0-0.8% en ALL según Fase 5; se documenta la diferencia
//     con la regla xg_cero de stats_features).
//   - media móvil de los últimos <=W partidos con dato; fallback a la
//     referencia de liga (raw) o 0 neutral (norm), idéntico a stats_features.
//   - refLiga = media acumulada previa de la liga (minRef=10) si no global
//     (minRef=10); norm = log(media/ref) → 0 = igual a la liga.
//   - SOLO TRAIN+VAL: el SQL filtra fecha <= fin de VAL (TEST no se carga).
// ---------------------------------------------------------------------------
const STATS = [
  { code: "tp", nombre: "Touches in penalty area" },
  { code: "f3p", nombre: "Final third phase" },
  { code: "f3e", nombre: "Final third entries" },
  { code: "sib", nombre: "Shots inside box" },
  { code: "ap", nombre: "Accurate passes" },
  { code: "pa", nombre: "Passes" },
];
const WINDOWS = [5, 10, 20];
const num = (v) => (v === null || v === undefined ? null : Number(v));
const dia = (f) => new Date(f).toISOString().slice(0, 10);

// Carga partidos TV + pivote stat×partido {loc, vis} (1T+2T si ambos, si no ALL).
async function cargarPartidosStats51(pool, valHasta) {
  const nombres = STATS.map((s) => `'${s.nombre}'`).join(",");
  const { rows } = await pool.query(`
    SELECT p.id, p.fecha_partido, p.liga, p.equipo_local, p.equipo_visitante,
           p.goles_local::int AS gh, p.goles_visitante::int AS ga,
           e.nombre, e.periodo, e.valor_local_num AS l, e.valor_visitante_num AS v
      FROM partidos p
      LEFT JOIN estadisticas e ON e.partido_id = p.id
        AND e.nombre IN (${nombres}) AND e.periodo IN ('ALL','1ST','2ND')
     WHERE p.estado='Ended' AND p.fecha_partido IS NOT NULL
       AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
       AND p.fecha_partido <= '${valHasta}'
     ORDER BY p.fecha_partido ASC, p.id ASC;`);
  const porId = new Map();
  // mx: ante duplicados (misma stat en 2 grupos de Sofascore) se toma MAX,
  // idéntico a la agregación MAX(CASE...) de stats_features.js.
  const mx = (a, b) => (a === null || a === undefined ? b : b === null || b === undefined ? a : Math.max(a, b));
  for (const r of rows) {
    if (!porId.has(r.id)) {
      porId.set(r.id, {
        id: r.id, fecha: r.fecha_partido, liga: r.liga, home: r.equipo_local, away: r.equipo_visitante,
        goalsH: r.gh, goalsA: r.ga, stats: Object.fromEntries(STATS.map((s) => [s.code, { loc: null, vis: null }])),
      });
    }
    if (!r.nombre) continue;
    const code = STATS.find((s) => s.nombre === r.nombre).code;
    const cell = porId.get(r.id).stats[code];
    if (r.periodo === "ALL") {
      cell.all = { loc: mx(cell.all && cell.all.loc, num(r.l)), vis: mx(cell.all && cell.all.vis, num(r.v)) };
    } else if (r.periodo === "1ST") {
      cell.t1 = { loc: mx(cell.t1 && cell.t1.loc, num(r.l)), vis: mx(cell.t1 && cell.t1.vis, num(r.v)) };
    } else if (r.periodo === "2ND") {
      cell.t2 = { loc: mx(cell.t2 && cell.t2.loc, num(r.l)), vis: mx(cell.t2 && cell.t2.vis, num(r.v)) };
    }
  }
  const out = [];
  for (const m of porId.values()) {
    for (const s of STATS) {
      const c = m.stats[s.code];
      const completo = c.t1 && c.t2 && c.t1.loc !== null && c.t2.loc !== null && c.t1.vis !== null && c.t2.vis !== null;
      if (completo) { c.loc = c.t1.loc + c.t2.loc; c.vis = c.t1.vis + c.t2.vis; }
      else if (c.all) { c.loc = c.all.loc; c.vis = c.all.vis; }
      delete c.t1; delete c.t2; delete c.all;
    }
    out.push(m);
  }
  return out;
}

const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const ultimos = (arr, k) => (arr.length > k ? arr.slice(arr.length - k) : arr);

// Construye TODOS los campos: `${code}_${w}_${raw|norm}_{forL,agL,forV,agV}`.
function construir51(matches, { minRef = 10 } = {}) {
  const histFor = new Map(); // equipo → { code: number[] }
  const histAg = new Map();
  const refLiga = new Map(); // liga → { code: {s,n} }
  const refGlobal = Object.fromEntries(STATS.map((s) => [s.code, { s: 0, n: 0 }]));
  const get = (map, eq) => {
    if (!map.has(eq)) map.set(eq, Object.fromEntries(STATS.map((s) => [s.code, []])));
    return map.get(eq);
  };
  const refDe = (liga, code) => {
    const rl = refLiga.get(liga);
    if (rl && rl[code].n >= minRef) return rl[code].s / rl[code].n;
    if (refGlobal[code].n >= minRef) return refGlobal[code].s / refGlobal[code].n;
    return null;
  };

  const items = new Array(matches.length);
  let i = 0;
  while (i < matches.length) {
    const d = dia(matches[i].fecha);
    let j = i;
    while (j < matches.length && dia(matches[j].fecha) === d) j++;
    // 1) predecir todo el día con el estado al inicio del día
    for (let k = i; k < j; k++) {
      const p = matches[k];
      const hf = histFor.get(p.home), af = histAg.get(p.home);
      const hv = histFor.get(p.away), av = histAg.get(p.away);
      const campos = {};
      for (const s of STATS) {
        const code = s.code;
        const ref = refDe(p.liga, code);
        for (const w of WINDOWS) {
          const mF = hf && hf[code].length ? media(ultimos(hf[code], w)) : null;
          const mA = af && af[code].length ? media(ultimos(af[code], w)) : null;
          const mFV = hv && hv[code].length ? media(ultimos(hv[code], w)) : null;
          const mAV = av && av[code].length ? media(ultimos(av[code], w)) : null;
          const raw = (m, r) => (m !== null ? m : (r ?? 0));
          const nrm = (m, r) => (m !== null && m > 0 && r !== null && r > 0 ? Math.log(m / r) : 0);
          campos[`${code}_${w}_forL`] = raw(mF, ref);
          campos[`${code}_${w}_agL`] = raw(mA, ref);
          campos[`${code}_${w}_forV`] = raw(mFV, ref);
          campos[`${code}_${w}_agV`] = raw(mAV, ref);
          campos[`${code}_${w}_nforL`] = nrm(mF, ref);
          campos[`${code}_${w}_nagL`] = nrm(mA, ref);
          campos[`${code}_${w}_nforV`] = nrm(mFV, ref);
          campos[`${code}_${w}_nagV`] = nrm(mAV, ref);
          // nº de partidos previos con dato reales (para redundancia/evit. fallback)
          campos[`${code}_${w}_nF`] = hf && hf[code].length ? Math.min(hf[code].length, w) : 0;
          campos[`${code}_${w}_nA`] = af && af[code].length ? Math.min(af[code].length, w) : 0;
          campos[`${code}_${w}_nFV`] = hv && hv[code].length ? Math.min(hv[code].length, w) : 0;
          campos[`${code}_${w}_nAV`] = av && av[code].length ? Math.min(av[code].length, w) : 0;
        }
      }
      items[k] = { ...p, ...campos };
    }
    // 2) ingerir el día completo
    for (let k = i; k < j; k++) {
      const p = matches[k];
      const add = (eq, propio, rival) => {
        const h = get(histFor, eq), a = get(histAg, eq);
        for (const s of STATS) {
          if (propio[s.code] !== null) { h[s.code].push(propio[s.code]); if (h[s.code].length > 20) h[s.code].shift(); }
          if (rival[s.code] !== null) { a[s.code].push(rival[s.code]); if (a[s.code].length > 20) a[s.code].shift(); }
        }
      };
      const ownH = Object.fromEntries(STATS.map((s) => [s.code, p.stats[s.code].loc]));
      const ownA = Object.fromEntries(STATS.map((s) => [s.code, p.stats[s.code].vis]));
      add(p.home, ownH, ownA);   // local: propio = loc, recibido = vis
      add(p.away, ownA, ownH);   // visitante: propio = vis, recibido = loc
      if (!refLiga.has(p.liga)) refLiga.set(p.liga, Object.fromEntries(STATS.map((s) => [s.code, { s: 0, n: 0 }])));
      const rl = refLiga.get(p.liga);
      for (const s of STATS) {
        for (const v of [p.stats[s.code].loc, p.stats[s.code].vis]) {
          if (v !== null) {
            refGlobal[s.code].s += v; refGlobal[s.code].n += 1;
            rl[s.code].s += v; rl[s.code].n += 1;
          }
        }
      }
    }
    i = j;
  }
  return items;
}

module.exports = { STATS, WINDOWS, cargarPartidosStats51, construir51 };
