// ---------------------------------------------------------------------------
// ESTADÍSTICAS (xG, remates, al arco) para V4/V5/V6 — FASE 2 experimental.
//
// REGLAS DE LIMPIEZA (anti data-quality):
//   - NULL → dato AUSENTE (nunca se convierte en 0).
//   - xG == 0  → cero SOSPECHOSO → AUSENTE (un xG=0 real con tiros es casi
//     imposible; la Liga Peruana Clausura mostró p25=0 por esto).
//   - Total shots == 0 → AUSENTE (un equipo profesional con 0 tiros = dato faltante).
//   - Shots on target == 0 → AUSENTE si no hubo tiros O si hubo goles (un equipo
//     que marca tiene al menos 1 tiro al arco salvo autogol; se trata conservador).
//     Es VÁLIDO si hubo tiros > 0 y 0 goles (tiros fuera del arco = reales).
//   - st > total shots (ambos presentes) → inconsistente → AUSENTES ambos.
//
// REGLAS TEMPORALES (anti data-leakage):
//   - Features de un partido en fecha D SOLO usan partidos con fecha < D
//     estrictamente (nada del mismo día).
//   - Media del equipo: últimos ≤5 partidos VÁLIDOS previos (por estadística).
//   - Referencia de liga en D: media de la liga en partidos anteriores a D
//     (n≥10 valores de equipo); si no, referencia GLOBAL previa (n≥10);
//     si no, la feature queda NEUTRA.
//   - normalizada = log(media_equipo / referencia)  → 0 = igual a la liga.
//   - cruda      = media_equipo (si no existe → referencia; si no → 0 documentado).
// ---------------------------------------------------------------------------
const STATS = ["Expected goals", "Total shots", "Shots on target"];
const num = (v) => (v === null || v === undefined ? null : Number(v));
const dia = (f) => new Date(f).toISOString().slice(0, 10);

// Query: patrón 1T+2T de features.js, pero SIN COALESCE a 0: si un medio no
// tiene valor numérico, no se suma nada (queda NULL y se usa ALL si existe).
async function cargarPartidosConStats(pool) {
  const q = `
    WITH est AS (
      SELECT partido_id, nombre,
        CASE WHEN MAX(CASE WHEN periodo='1ST' THEN 1 END)=1 AND MAX(CASE WHEN periodo='2ND' THEN 1 END)=1
              AND MAX(CASE WHEN periodo='1ST' THEN valor_local_num END) IS NOT NULL
              AND MAX(CASE WHEN periodo='2ND' THEN valor_local_num END) IS NOT NULL
          THEN MAX(CASE WHEN periodo='1ST' THEN valor_local_num END)
             + MAX(CASE WHEN periodo='2ND' THEN valor_local_num END) END AS loc_t,
        CASE WHEN MAX(CASE WHEN periodo='1ST' THEN 1 END)=1 AND MAX(CASE WHEN periodo='2ND' THEN 1 END)=1
              AND MAX(CASE WHEN periodo='1ST' THEN valor_visitante_num END) IS NOT NULL
              AND MAX(CASE WHEN periodo='2ND' THEN valor_visitante_num END) IS NOT NULL
          THEN MAX(CASE WHEN periodo='1ST' THEN valor_visitante_num END)
             + MAX(CASE WHEN periodo='2ND' THEN valor_visitante_num END) END AS vis_t,
        MAX(CASE WHEN periodo='ALL' THEN valor_local_num END) AS loc_a,
        MAX(CASE WHEN periodo='ALL' THEN valor_visitante_num END) AS vis_a
      FROM estadisticas
      WHERE nombre IN (${STATS.map((s) => `'${s}'`).join(",")})
      GROUP BY partido_id, nombre
    ),
    w AS (
      SELECT partido_id,
        MAX(CASE WHEN nombre='Expected goals' THEN COALESCE(loc_t, loc_a) END) AS xgl,
        MAX(CASE WHEN nombre='Expected goals' THEN COALESCE(vis_t, vis_a) END) AS xgv,
        MAX(CASE WHEN nombre='Total shots'     THEN COALESCE(loc_t, loc_a) END) AS tsl,
        MAX(CASE WHEN nombre='Total shots'     THEN COALESCE(vis_t, vis_a) END) AS tsv,
        MAX(CASE WHEN nombre='Shots on target' THEN COALESCE(loc_t, loc_a) END) AS stl,
        MAX(CASE WHEN nombre='Shots on target' THEN COALESCE(vis_t, vis_a) END) AS stv
      FROM est GROUP BY partido_id
    )
    SELECT p.id, p.fecha_partido, p.liga, p.equipo_local, p.equipo_visitante,
      p.goles_local::int AS gh, p.goles_visitante::int AS ga,
      w.xgl, w.xgv, w.tsl, w.tsv, w.stl, w.stv
    FROM partidos p LEFT JOIN w ON w.partido_id = p.id
    WHERE p.estado='Ended' AND p.fecha_partido IS NOT NULL
      AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
    ORDER BY p.fecha_partido ASC, p.id ASC;`;
  const { rows } = await pool.query(q);
  return rows.map((r) => ({
    id: r.id, fecha: r.fecha_partido, liga: r.liga, home: r.equipo_local, away: r.equipo_visitante,
    goalsH: r.gh, goalsA: r.ga,
    xgL: num(r.xgl), xgV: num(r.xgv), tsl: num(r.tsl), tsv: num(r.tsv), stl: num(r.stl), stv: num(r.stv),
  }));
}

// Limpieza de UN lado del partido (un equipo en un partido)
function limpiarLado({ xg, ts, st, goles }) {
  const out = { xg: null, ts: null, st: null };
  const razones = [];
  if (xg === null) razones.push("xg_null");
  else if (xg === 0) razones.push("xg_cero");
  else out.xg = xg;
  if (ts === null) razones.push("ts_null");
  else if (ts === 0) razones.push("ts_cero");
  else out.ts = ts;
  if (st === null) razones.push("st_null");
  else if (st === 0 && (ts === null || ts === 0)) razones.push("st_cero_sin_remates");
  else if (st === 0 && goles > 0) razones.push("st_cero_con_goles");
  else if (ts !== null && ts > 0 && st > ts) razones.push("st_mayor_que_ts");
  else if (ts === 0 && st > 0) razones.push("st_con_ts_cero");
  else out.st = st;
  return { out, razones };
}

function limpiarPartido(p) {
  const L = limpiarLado({ xg: p.xgL, ts: p.tsl, st: p.stl, goles: p.goalsH });
  const V = limpiarLado({ xg: p.xgV, ts: p.tsv, st: p.stv, goles: p.goalsA });
  return { L: L.out, V: V.out, razones: [...L.razones.map((r) => "L:" + r), ...V.razones.map((r) => "V:" + r)] };
}

// Cobertura tras limpieza (por liga y global), solo lectura del array ya limpio
function cobertura(partidos, limpios) {
  const cuenta = { lados: 0, xg: 0, ts: 0, st: 0, razones: {} };
  const porLiga = new Map();
  partidos.forEach((p, i) => {
    if (!porLiga.has(p.liga)) porLiga.set(p.liga, { n: 0, xgLados: 0, tsLados: 0, stLados: 0, xgAmbos: 0 });
    const L = porLiga.get(p.liga);
    L.n += 1;
    for (const r of limpios[i].razones) cuenta.razones[r] = (cuenta.razones[r] || 0) + 1;
    const lados = [limpios[i].L, limpios[i].V];
    let ambos = { xg: 0, ts: 0, st: 0 };
    for (const lado of lados) {
      cuenta.lados += 1;
      if (lado.xg !== null) { cuenta.xg += 1; L.xgLados += 1; ambos.xg += 1; }
      if (lado.ts !== null) { cuenta.ts += 1; L.tsLados += 1; ambos.ts += 1; }
      if (lado.st !== null) { cuenta.st += 1; L.stLados += 1; ambos.st += 1; }
    }
    L.xgAmbos += ambos.xg === 2 ? 1 : 0;
  });
  const filas = [...porLiga].map(([liga, v]) => ({
    liga, n: v.n,
    xgPct: Math.round((100 * v.xgLados) / (2 * v.n) * 10) / 10,
    tsPct: Math.round((100 * v.tsLados) / (2 * v.n) * 10) / 10,
    stPct: Math.round((100 * v.stLados) / (2 * v.n) * 10) / 10,
    xgAmbosPct: Math.round((100 * v.xgAmbos) / v.n * 10) / 10,
  })).sort((a, b) => b.n - a.n);
  return { global: cuenta, porLiga: filas };
}

const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const ultimos = (arr, k) => (arr.length > k ? arr.slice(arr.length - k) : arr);

// Construye las features temporales de cada partido (orden cronológico, día estricto)
function construirFeatures(partidos, { ventana = 5, minRef = 10 } = {}) {
  const limpios = partidos.map(limpiarPartido);
  const histFor = new Map(); // eq → { xg:[], ts:[], st:[] } valores PROPIOS
  const histAg = new Map();  // eq → { xg:[], ts:[], st:[] } valores RECIBIDOS
  const refLiga = new Map(); // liga → { xg:{s,n}, ts:{s,n}, st:{s,n} }
  const refGlobal = { xg: { s: 0, n: 0 }, ts: { s: 0, n: 0 }, st: { s: 0, n: 0 } };
  const get = (map, eq) => {
    if (!map.has(eq)) map.set(eq, { xg: [], ts: [], st: [] });
    return map.get(eq);
  };
  const refDe = (liga, stat) => {
    const rl = refLiga.get(liga);
    if (rl && rl[stat].n >= minRef) return rl[stat].s / rl[stat].n;
    if (refGlobal[stat].n >= minRef) return refGlobal[stat].s / refGlobal[stat].n;
    return null;
  };
  const norm = (media_, ref) => (media_ !== null && media_ > 0 && ref !== null && ref > 0 ? Math.log(media_ / ref) : 0);
  const raw = (media_, ref) => (media_ !== null ? media_ : (ref ?? 0));

  const items = new Array(partidos.length);
  let i = 0;
  while (i < partidos.length) {
    const d = dia(partidos[i].fecha);
    let j = i;
    while (j < partidos.length && dia(partidos[j].fecha) === d) j++;
    // 1) features para todo el día desde el estado al INICIO del día
    for (let k = i; k < j; k++) {
      const p = partidos[k];
      const lim = limpios[k];
      const ref = { xg: refDe(p.liga, "xg"), ts: refDe(p.liga, "ts"), st: refDe(p.liga, "st") };
      const side = (eq, limLado, histF, histA) => {
        const f = { xg: null, ts: null, st: null };
        const a = { xg: null, ts: null, st: null };
        const hf = histF.has(eq) ? histF.get(eq) : null;
        const ha = histA.has(eq) ? histA.get(eq) : null;
        for (const s of ["xg", "ts", "st"]) {
          if (hf && hf[s].length) f[s] = media(ultimos(hf[s], ventana));
          if (ha && ha[s].length) a[s] = media(ultimos(ha[s], ventana));
        }
        return {
          xgnF: norm(f.xg, ref.xg), xgnA: norm(a.xg, ref.xg),
          xgrF: raw(f.xg, ref.xg), xgrA: raw(a.xg, ref.xg),
          tsnF: norm(f.ts, ref.ts), tsnA: norm(a.ts, ref.ts),
          tsrF: raw(f.ts, ref.ts), tsrA: raw(a.ts, ref.ts),
          stnF: norm(f.st, ref.st), stnA: norm(a.st, ref.st),
          strF: raw(f.st, ref.st), strA: raw(a.st, ref.st),
        };
      };
      const H = side(p.home, lim.L, histFor, histAg);
      const V = side(p.away, lim.V, histFor, histAg);
      items[k] = {
        ...p,
        xgnF_L: H.xgnF, xgnA_L: H.xgnA, xgrF_L: H.xgrF, xgrA_L: H.xgrA,
        tsnF_L: H.tsnF, tsnA_L: H.tsnA, tsrF_L: H.tsrF, tsrA_L: H.tsrA,
        stnF_L: H.stnF, stnA_L: H.stnA, strF_L: H.strF, strA_L: H.strA,
        xgnF_V: V.xgnF, xgnA_V: V.xgnA, xgrF_V: V.xgrF, xgrA_V: V.xgrA,
        tsnF_V: V.tsnF, tsnA_V: V.tsnA, tsrF_V: V.tsrF, tsrA_V: V.tsrA,
        stnF_V: V.stnF, stnA_V: V.stnA, strF_V: V.strF, strA_V: V.strA,
      };
    }
    // 2) ingerir el día completo (después de predecir todos sus partidos)
    for (let k = i; k < j; k++) {
      const p = partidos[k];
      const lim = limpios[k];
      const ingest = (eq, limLado) => {
        const hf = get(histFor, eq), ha = get(histAg, eq);
        for (const s of ["xg", "ts", "st"]) {
          const v = limLado[s];
          if (v !== null) {
            hf[s].push(v);
            if (hf[s].length > 20) hf[s].shift();
          }
        };
        // recibidos = valor del RIVAL
        const opp = eq === p.home ? lim.V : lim.L;
        for (const s of ["xg", "ts", "st"]) {
          const v = opp[s];
          if (v !== null) {
            ha[s].push(v);
            if (ha[s].length > 20) ha[s].shift();
          }
        }
      };
      ingest(p.home, lim.L);
      ingest(p.away, lim.V);
      const addRef = (limLado) => {
        for (const s of ["xg", "ts", "st"]) {
          const v = limLado[s];
          if (v !== null) {
            refGlobal[s].s += v; refGlobal[s].n += 1;
            if (!refLiga.has(p.liga)) refLiga.set(p.liga, { xg: { s: 0, n: 0 }, ts: { s: 0, n: 0 }, st: { s: 0, n: 0 } });
            const rl = refLiga.get(p.liga)[s];
            rl.s += v; rl.n += 1;
          }
        }
      };
      addRef(lim.L);
      addRef(lim.V);
    }
    i = j;
  }
  return { items, limpios };
}

module.exports = { cargarPartidosConStats, limpiarPartido, limpiarLado, cobertura, construirFeatures };
