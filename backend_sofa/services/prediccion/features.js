const pool = require("../../db");

// ---------------------------------------------------------------------------
// Capa de datos del análisis predictivo.
//
// REGLA DE ORO (anti data-leakage): TODA función de este archivo recibe
// `fechaCorte` y solo consulta partidos con fecha_partido < fechaCorte.
// Nunca se incluye el partido que se está prediciendo ni nada posterior.
// ---------------------------------------------------------------------------

// Stats que se agregan del histórico (nombre real en la tabla `estadisticas`).
// Ojo: la tabla tiene filas duplicadas en ~8.400 combinaciones, por eso se
// agregan siempre con MAX() y nunca con SUM().
const STATS = [
  { nombre: "Expected goals", alias: "xg" },
  { nombre: "Total shots", alias: "remates" },
  { nombre: "Shots on target", alias: "al_arco" },
  { nombre: "Corner kicks", alias: "corners" },
  { nombre: "Fouls", alias: "faltas" },
  { nombre: "Yellow cards", alias: "amarillas" },
];

const PERIODOS = ["1ST", "2ND"];

const colPropia = `CASE WHEN p.equipo_local = $1 THEN e.valor_local_num ELSE e.valor_visitante_num END`;
const colRival = `CASE WHEN p.equipo_local = $1 THEN e.valor_visitante_num ELSE e.valor_local_num END`;

// Columnas agregadas: propio/rival × stat × 1T/2T. Se evita ALL porque en
// partidos con tiempo extra ALL incluye prórroga; el total se calcula 1T+2T.
const columnasStats = () => {
  const cols = [];
  for (const s of STATS) {
    for (const per of PERIODOS) {
      const suf = per === "1ST" ? "t1" : "t2";
      cols.push(
        `MAX(CASE WHEN e.nombre = '${s.nombre}' AND e.periodo = '${per}' THEN ${colPropia} END) AS ${s.alias}_${suf}`
      );
      cols.push(
        `MAX(CASE WHEN e.nombre = '${s.nombre}' AND e.periodo = '${per}' THEN ${colRival} END) AS ${s.alias}_${suf}_r`
      );
    }
  }
  // Posesión es porcentaje (38 = 38%): se toma directo del periodo ALL.
  cols.push(`MAX(CASE WHEN e.nombre = 'Ball possession' AND e.periodo = 'ALL' THEN ${colPropia} END) AS posesion`);
  cols.push(`MAX(CASE WHEN e.nombre = 'Ball possession' AND e.periodo = 'ALL' THEN ${colRival} END) AS posesion_r`);
  return cols.join(",\n        ");
};

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

const prom = (vals) => {
  const limpios = vals.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (!limpios.length) return null;
  return limpios.reduce((a, b) => a + b, 0) / limpios.length;
};

// Devuelve el nombre canónico del equipo como está guardado en la BD
// (resuelve mayúsculas/minúsculas y espacios).
async function resolverEquipo(nombre) {
  const query = `
    SELECT nombre FROM (
      SELECT equipo_local AS nombre FROM partidos
      UNION
      SELECT equipo_visitante FROM partidos
    ) x
    WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))
    LIMIT 1;`;
  const { rows } = await pool.query(query, [nombre]);
  return rows[0]?.nombre || null;
}

// Últimos `limite` partidos del equipo anteriores a fechaCorte.
// Devuelve goles (FT y 1T) y stats por tiempo del propio equipo y del rival.
async function getHistorial(equipo, fechaCorte, limite = 40) {
  const query = `
    SELECT
      p.id,
      p.fecha_partido,
      p.liga,
      CASE WHEN p.equipo_local = $1 THEN 1 ELSE 0 END AS es_local,
      CASE WHEN p.equipo_local = $1 THEN p.equipo_visitante ELSE p.equipo_local END AS rival,
      CASE WHEN p.equipo_local = $1 THEN p.goles_local ELSE p.goles_visitante END AS gf,
      CASE WHEN p.equipo_local = $1 THEN p.goles_visitante ELSE p.goles_local END AS gc,
      CASE WHEN p.equipo_local = $1 THEN COALESCE(p.goles_local_1t, 0) ELSE COALESCE(p.goles_visitante_1t, 0) END AS gf_t1,
      CASE WHEN p.equipo_local = $1 THEN COALESCE(p.goles_visitante_1t, 0) ELSE COALESCE(p.goles_local_1t, 0) END AS gc_t1,
      ${columnasStats()}
    FROM partidos p
    LEFT JOIN estadisticas e ON e.partido_id = p.id
    WHERE (p.equipo_local = $1 OR p.equipo_visitante = $1)
      AND p.estado = 'Ended'
      AND p.fecha_partido IS NOT NULL
      AND p.fecha_partido < $2::date
    GROUP BY p.id
    ORDER BY p.fecha_partido DESC, p.id DESC
    LIMIT $3;`;
  const { rows } = await pool.query(query, [equipo, fechaCorte, limite]);

  return rows.map((r) => {
    const gf = num(r.gf) ?? 0;
    const gc = num(r.gc) ?? 0;
    const gfT1 = num(r.gf_t1) ?? 0;
    const gcT1 = num(r.gc_t1) ?? 0;
    return {
      id: r.id,
      fecha: r.fecha_partido,
      liga: r.liga,
      es_local: Number(r.es_local) === 1,
      rival: r.rival,
      gf,
      gc,
      gf_t1: gfT1,
      gf_t2: gf - gfT1,
      gc_t1: gcT1,
      gc_t2: gc - gcT1,
      xg: sum(num(r.xg_t1), num(r.xg_t2)),
      xg_t1: num(r.xg_t1),
      xg_r: sum(num(r.xg_t1_r), num(r.xg_t2_r)),
      remates: sum(num(r.remates_t1), num(r.remates_t2)),
      remates_t1: num(r.remates_t1),
      remates_r: sum(num(r.remates_t1_r), num(r.remates_t2_r)),
      al_arco: sum(num(r.al_arco_t1), num(r.al_arco_t2)),
      al_arco_t1: num(r.al_arco_t1),
      al_arco_r: sum(num(r.al_arco_t1_r), num(r.al_arco_t2_r)),
      corners: sum(num(r.corners_t1), num(r.corners_t2)),
      corners_t1: num(r.corners_t1),
      corners_r: sum(num(r.corners_t1_r), num(r.corners_t2_r)),
      posesion: num(r.posesion),
      faltas: num(r.faltas_t1) !== null || num(r.faltas_t2) !== null ? sum(num(r.faltas_t1), num(r.faltas_t2)) : null,
      amarillas:
        num(r.amarillas_t1) !== null || num(r.amarillas_t2) !== null
          ? sum(num(r.amarillas_t1), num(r.amarillas_t2))
          : null,
      xg_t1_r: num(r.xg_t1_r),
      al_arco_t1_r: num(r.al_arco_t1_r),
      corners_t1_r: num(r.corners_t1_r),
    };
  });
}

function sum(a, b) {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

// Ventana de forma: últimos N partidos → V/E/D, porcentajes y goles.
function forma(filas, n) {
  const ventana = filas.slice(0, n);
  if (!ventana.length) return { n: 0 };
  const v = ventana.filter((f) => f.gf > f.gc).length;
  const e = ventana.filter((f) => f.gf === f.gc).length;
  const d = ventana.filter((f) => f.gf < f.gc).length;
  const gf = ventana.reduce((a, f) => a + f.gf, 0);
  const gc = ventana.reduce((a, f) => a + f.gc, 0);
  return {
    n: ventana.length,
    victorias: v,
    empates: e,
    derrotas: d,
    pctVictorias: Math.round((v / ventana.length) * 1000) / 10,
    golesFavor: gf,
    golesContra: gc,
    diferenciaGoles: gf - gc,
    desde: ventana[ventana.length - 1].fecha,
    hasta: ventana[0].fecha,
  };
}

// Promedios por partido de un conjunto de filas (ataque/defensa/1T/2T).
function promedios(filas) {
  if (!filas.length) return { n: 0 };
  const m = (sel) => prom(filas.map(sel));
  return {
    n: filas.length,
    gf: m((f) => f.gf),
    gc: m((f) => f.gc),
    gf_t1: m((f) => f.gf_t1),
    gf_t2: m((f) => f.gf_t2),
    gc_t1: m((f) => f.gc_t1),
    gc_t2: m((f) => f.gc_t2),
    xg: m((f) => f.xg),
    xg_rival: m((f) => f.xg_r),
    xg_t1: m((f) => f.xg_t1),
    remates: m((f) => f.remates),
    remates_t1: m((f) => f.remates_t1),
    rematesRecibidos: m((f) => f.remates_r),
    al_arco: m((f) => f.al_arco),
    al_arco_t1: m((f) => f.al_arco_t1),
    al_arcoRecibidos: m((f) => f.al_arco_r),
    corners: m((f) => f.corners),
    corners_t1: m((f) => f.corners_t1),
    cornersConcedidos: m((f) => f.corners_r),
    posesion: m((f) => f.posesion),
    faltas: m((f) => f.faltas),
    amarillas: m((f) => f.amarillas),
  };
}

// Perfil completo del equipo a una fecha de corte.
async function getPerfilEquipo(equipo, fechaCorte, { limite = 40 } = {}) {
  const historial = await getHistorial(equipo, fechaCorte, limite);
  const comoLocal = historial.filter((f) => f.es_local);
  const comoVisitante = historial.filter((f) => !f.es_local);

  return {
    equipo,
    fechaCorte,
    partidosConsiderados: historial.length,
    primerPartido: historial.length ? historial[historial.length - 1].fecha : null,
    ultimoPartido: historial.length ? historial[0].fecha : null,
    forma: {
      ultimos5: forma(historial, 5),
      ultimos10: forma(historial, 10),
      ultimos20: forma(historial, 20),
    },
    // Todos los partidos previos disponibles (hasta el límite).
    ataqueDefensa: promedios(historial),
    // Recencia: promedio de los últimos 10 partidos.
    ultimos10Promedios: promedios(historial.slice(0, 10)),
    comoLocal: { ...promedios(comoLocal), detalle: comoLocal.slice(0, 10) },
    comoVisitante: { ...promedios(comoVisitante), detalle: comoVisitante.slice(0, 10) },
    recientes: historial.slice(0, 5).map((f) => ({
      fecha: f.fecha,
      liga: f.liga,
      rival: f.rival,
      condicion: f.es_local ? "Local" : "Visita",
      gf: f.gf,
      gc: f.gc,
      resultado: f.gf > f.gc ? "V" : f.gf === f.gc ? "E" : "D",
    })),
  };
}

// Enfrentamientos directos previos a fechaCorte (máx `limite`).
async function getH2H(local, visitante, fechaCorte, limite = 5) {
  const query = `
    SELECT
      p.id,
      p.fecha_partido,
      p.liga,
      p.equipo_local,
      p.equipo_visitante,
      p.goles_local,
      p.goles_visitante,
      COALESCE(p.goles_local_1t, 0) AS goles_local_1t,
      COALESCE(p.goles_visitante_1t, 0) AS goles_visitante_1t,
      MAX(CASE WHEN e.nombre = 'Corner kicks' AND e.periodo = 'ALL' AND p.equipo_local = $1 THEN e.valor_local_num END) AS corners_local,
      MAX(CASE WHEN e.nombre = 'Corner kicks' AND e.periodo = 'ALL' AND p.equipo_local = $1 THEN e.valor_visitante_num END) AS corners_visitante
    FROM partidos p
    LEFT JOIN estadisticas e ON e.partido_id = p.id
    WHERE (
        (p.equipo_local = $1 AND p.equipo_visitante = $2)
        OR (p.equipo_local = $2 AND p.equipo_visitante = $1)
      )
      AND p.estado = 'Ended'
      AND p.fecha_partido IS NOT NULL
      AND p.fecha_partido < $3::date
    GROUP BY p.id
    ORDER BY p.fecha_partido DESC, p.id DESC
    LIMIT $4;`;
  const { rows } = await pool.query(query, [local, visitante, fechaCorte, limite]);

  const partidos = rows.map((r) => {
    const esLocalLocal = r.equipo_local === local;
    // Resultado DESDE la perspectiva del equipo `local` (el analizado),
    // sin importar si en ese partido jugó de local o de visita.
    const golesEquipo = esLocalLocal ? (r.goles_local ?? 0) : (r.goles_visitante ?? 0);
    const golesRival = esLocalLocal ? (r.goles_visitante ?? 0) : (r.goles_local ?? 0);
    return {
      fecha: r.fecha_partido,
      liga: r.liga,
      equipo_local: r.equipo_local,
      equipo_visitante: r.equipo_visitante,
      goles_local: r.goles_local,
      goles_visitante: r.goles_visitante,
      goles_total: (r.goles_local ?? 0) + (r.goles_visitante ?? 0),
      corners_local: num(r.corners_local),
      corners_visitante: num(r.corners_visitante),
      equipoLocalEsLocal: esLocalLocal,
      resultadoParaLocal: golesEquipo > golesRival ? "V" : golesEquipo === golesRival ? "E" : "D",
    };
  });

  const cuenta = (lista) => ({
    n: lista.length,
    victorias: lista.filter((p) => p.resultadoParaLocal === "V").length,
    empates: lista.filter((p) => p.resultadoParaLocal === "E").length,
    derrotas: lista.filter((p) => p.resultadoParaLocal === "D").length,
  });

  const resumen = {
    ...cuenta(partidos),
    comoLocal: cuenta(partidos.filter((p) => p.equipoLocalEsLocal)),
    comoVisitante: cuenta(partidos.filter((p) => !p.equipoLocalEsLocal)),
    promedioGoles: partidos.length
      ? Math.round((partidos.reduce((a, p) => a + p.goles_total, 0) / partidos.length) * 100) / 100
      : null,
  };

  return { partidos, resumen };
}

module.exports = {
  resolverEquipo,
  getHistorial,
  getPerfilEquipo,
  getH2H,
  forma,
  promedios,
};
