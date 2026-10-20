// ---------------------------------------------------------------------------
// REALES POR PERIODO: valores reales de un partido (1T / 2T / Partido) de
// goles, corners y remates. Se usa para pintar la columna "Mas/Menos" en
// verde (acierto) o rojo (fallo) tanto en el historial 1X2 como en la
// proyeccion 2T (cuando el partido ya esta en la base y hay datos reales).
// ---------------------------------------------------------------------------
const pool = require("../../db");

// p: fila de `partidos` con id, goles y goles 1T.
async function realesPorTiempo(p) {
  const out = { goles: {}, corners: {}, remates: {} };
  // Goles: 1T viene del marcador, 2T = final - 1T.
  const gl = p.goles_local, gv = p.goles_visitante;
  const g1l = p.goles_local_1t, g1v = p.goles_visitante_1t;
  if (gl != null && gv != null) {
    out.goles["Partido"] = { l: gl, v: gv };
    if (g1l != null && g1v != null) {
      out.goles["1T"] = { l: g1l, v: g1v };
      out.goles["2T"] = { l: gl - g1l, v: gv - g1v };
    }
  }
  // Corners / remates: periodos 1ST / 2ND / ALL de la tabla estadisticas.
  const s = await pool.query(
    `SELECT nombre, periodo,
       max(valor_local_num)::float AS l, max(valor_visitante_num)::float AS v
     FROM estadisticas
     WHERE partido_id = $1 AND nombre = ANY($2)
       AND periodo IN ('1ST','2ND','ALL')
       AND valor_local_num IS NOT NULL AND valor_visitante_num IS NOT NULL
     GROUP BY 1, 2`,
    [p.id, ["Corner kicks", "Total shots"]]
  );
  const mapa = { "Corner kicks": "corners", "Total shots": "remates" };
  const etiqueta = { "1ST": "1T", "2ND": "2T", "ALL": "Partido" };
  for (const r of s.rows) {
    const k = mapa[r.nombre];
    if (!k) continue;
    out[k][etiqueta[r.periodo]] = { l: r.l, v: r.v };
  }
  return out;
}

// Busca el partido en la base (por id de Sofascore o por equipos + fecha) y
// devuelve sus reales por periodo. null si no esta o no hay datos.
async function realesDePartido({ id, local, visitante, fecha }) {
  let fila = null;
  if (id != null) {
    const r = await pool.query(
      `SELECT id, goles_local, goles_visitante, goles_local_1t, goles_visitante_1t
       FROM partidos WHERE id::text = $1 LIMIT 1`,
      [String(id)]
    );
    if (r.rows.length) fila = r.rows[0];
  }
  if (!fila && local && visitante && fecha) {
    const r = await pool.query(
      `SELECT id, goles_local, goles_visitante, goles_local_1t, goles_visitante_1t
       FROM partidos
       WHERE equipo_local = $1 AND equipo_visitante = $2
         AND fecha_partido BETWEEN ($3::date - 1) AND ($3::date + 1)
       ORDER BY fecha_partido LIMIT 1`,
      [local, visitante, fecha]
    );
    if (r.rows.length) fila = r.rows[0];
  }
  if (!fila) return null;
  const reales = await realesPorTiempo(fila);
  const hayAlgo = Object.values(reales).some((m) => Object.keys(m).length);
  return hayAlgo ? reales : null;
}

module.exports = { realesPorTiempo, realesDePartido };
