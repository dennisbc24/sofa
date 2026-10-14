// ---------------------------------------------------------------------------
// PREVISIBILIDAD POR EQUIPO Y MERCADO — qué tan predecible es un equipo en
// cada mercado (goles total, corners total, remates total, remates del equipo).
// Se calcula sobre sus últimos N partidos (default 10) antes de la fecha de
// corte: con la desviación muestral σ de cada serie, P(acierto) = 2·Φ(tol/σ)−1
// (normal), donde tol es la tolerancia que define "acertar":
//   goles total ±1 · corners total ±2 · remates total ±3 · remates equipo ±2.
// Equipos con resultados muy variables → σ grande → P baja (impredecibles).
// Se usa en el análisis pre-partido y en la proyección 2T.
// ---------------------------------------------------------------------------
const pool = require("../../db");

const N_DEFAULT = 10;
const N_MIN = 3;
const TOL = { golesTotal: 1, cornersTotal: 2, rematesTotal: 3, rematesEquipo: 2 };

// Φ(x) con erf de Abramowitz-Stegun (error < 1.5e-7).
function phi(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp((-x * x) / 2);
  const erf = x < 0 ? -y : y;
  return (1 + erf) / 2;
}

const desv = (xs) => {
  if (xs.length < N_MIN) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
};
const probDe = (sigma, tol) => {
  if (sigma === null || !(sigma >= 0)) return null;
  if (sigma === 0) return 99.9;
  const p = 100 * (2 * phi(tol / sigma) - 1);
  return Math.round(Math.min(99.9, Math.max(0.1, p)) * 10) / 10;
};

async function serieEquipo(equipo, fechaCorte, n = N_DEFAULT) {
  const r = await pool.query(
    `SELECT p.equipo_local, p.equipo_visitante, p.goles_local, p.goles_visitante,
            max(CASE WHEN e.nombre = 'Corner kicks' THEN e.valor_local_num END)::float AS c_l,
            max(CASE WHEN e.nombre = 'Corner kicks' THEN e.valor_visitante_num END)::float AS c_v,
            max(CASE WHEN e.nombre = 'Total shots' THEN e.valor_local_num END)::float AS r_l,
            max(CASE WHEN e.nombre = 'Total shots' THEN e.valor_visitante_num END)::float AS r_v
       FROM partidos p
       LEFT JOIN estadisticas e
         ON e.partido_id = p.id AND e.periodo = 'ALL'
        AND e.nombre IN ('Corner kicks', 'Total shots')
      WHERE p.estado = 'Ended'
        AND p.fecha_partido < $2::date
        AND (p.equipo_local = $1 OR p.equipo_visitante = $1)
        AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
      GROUP BY p.id, p.equipo_local, p.equipo_visitante, p.goles_local, p.goles_visitante, p.fecha_partido
      ORDER BY p.fecha_partido DESC
      LIMIT $3`,
    [equipo, fechaCorte, n]
  );
  const esLocal = (x) => x.equipo_local === equipo;
  const golesTotal = [], cornersTotal = [], rematesTotal = [], rematesEquipo = [];
  for (const x of r.rows) {
    golesTotal.push(x.goles_local + x.goles_visitante);
    if (x.c_l != null && x.c_v != null) cornersTotal.push(x.c_l + x.c_v);
    if (x.r_l != null && x.r_v != null) rematesTotal.push(x.r_l + x.r_v);
    const rq = esLocal(x) ? x.r_l : x.r_v;
    if (rq != null) rematesEquipo.push(rq);
  }
  return {
    equipo,
    n: r.rows.length,
    golesTotal: probDe(desv(golesTotal), TOL.golesTotal),
    cornersTotal: probDe(desv(cornersTotal), TOL.cornersTotal),
    rematesTotal: probDe(desv(rematesTotal), TOL.rematesTotal),
    rematesEquipo: probDe(desv(rematesEquipo), TOL.rematesEquipo),
  };
}

async function calcularPrevisibilidad(local, visitante, fechaCorte, n = N_DEFAULT) {
  const [l, v] = await Promise.all([
    serieEquipo(local, fechaCorte, n),
    serieEquipo(visitante, fechaCorte, n),
  ]);
  return { local: l, visita: v };
}

module.exports = { calcularPrevisibilidad, N_DEFAULT, TOL };
