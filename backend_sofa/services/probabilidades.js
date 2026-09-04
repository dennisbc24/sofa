const pool = require("../db");

const STATS_VALIDAS = new Set(["Corner kicks", "Total shots"]);

const _stat = (stat) => {
  if (!STATS_VALIDAS.has(stat)) throw new Error(`Estadística no soportada: ${stat}`);
  return stat.replace(/'/g, "''");
};

const statS = (stat, periodo, lado) =>
  `COALESCE(MAX(CASE WHEN e.periodo = '${periodo}' AND e.nombre = '${_stat(stat)}' THEN e.valor_${lado}::int END), 0)`;

const stat1T = (stat) => `(${statS(stat, "1ST", "local")} + ${statS(stat, "1ST", "visitante")})`;
const stat2T = (stat) => `(${statS(stat, "2ND", "local")} + ${statS(stat, "2ND", "visitante")})`;
const statTotal = (stat) => `(${stat1T(stat)} + ${stat2T(stat)})`;

// Partidos con al menos 1 tarjeta roja en el primer tiempo
const ROJA_1T_FILTER = `p.id IN (
  SELECT r.partido_id FROM estadisticas r
  WHERE r.nombre = 'Red cards' AND r.periodo = '1ST'
    AND (COALESCE(r.valor_local_num, 0) + COALESCE(r.valor_visitante_num, 0)) >= 1
)`;

const filtroActivo = (v) => v !== undefined && v !== null && v !== "";

class ProbabilidadesService {
  async getProbabilidades(ligas, jornada, stat, goles, statName = "Corner kicks", prefijo = "corners", opciones = {}) {
    const params = [];
    const where = [];
    const having = [];

    if (ligas.length) {
      params.push(ligas);
      where.push(`p.liga = ANY($${params.length}::text[])`);
    }

    if (jornada > 0) {
      params.push(jornada);
      where.push(`p.fecha_jornada > $${params.length}`);
    }

    if (opciones.roja1t) {
      where.push(ROJA_1T_FILTER);
    }

    where.push(`e.nombre IN ('${_stat(statName)}')`);

    if (filtroActivo(stat)) {
      params.push(Number(stat));
      having.push(`${stat1T(statName)} = $${params.length}`);
    }

    if (filtroActivo(goles)) {
      params.push(Number(goles));
      having.push(`(p.goles_local_1T + p.goles_visitante_1T) = $${params.length}`);
    }

    const query = `
      SELECT
        p.id,
        p.liga,
        p.fecha_jornada,
        p.equipo_local,
        p.equipo_visitante,
        (p.goles_local_1T + p.goles_visitante_1T) AS goles_total_1t,
        ((p.goles_local - p.goles_local_1T) + (p.goles_visitante - p.goles_visitante_1T)) AS goles_total_2t,
        ${stat1T(statName)} AS ${prefijo}_total_1t,
        ${stat2T(statName)} AS ${prefijo}_total_2t,
        ${statTotal(statName)} AS total_${prefijo}
      FROM estadisticas e
      JOIN partidos p ON p.id = e.partido_id
      WHERE ${where.join(" AND ")}
      GROUP BY p.id, p.liga, p.fecha_jornada, p.equipo_local, p.equipo_visitante, p.goles_local, p.goles_visitante, p.goles_local_1T, p.goles_visitante_1T
      ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
      ORDER BY total_${prefijo} DESC;
    `;

    const { rows } = await pool.query(query, params);
    return rows;
  }

  _buildFiltros(
    ligas,
    jornada,
    stat,
    goles,
    { diferencia = false, conDiferencia = true, statName = "Corner kicks", roja1t = false } = {}
  ) {
    const params = [];
    const where = [];
    const having = [];

    if (ligas.length) {
      params.push(ligas);
      where.push(`p.liga = ANY($${params.length}::text[])`);
    }

    if (jornada > 0) {
      params.push(jornada);
      where.push(`p.fecha_jornada > $${params.length}`);
    }

    if (roja1t) {
      where.push(ROJA_1T_FILTER);
    }

    where.push(`e.nombre IN ('${_stat(statName)}')`);

    if (filtroActivo(stat)) {
      params.push(Number(stat));
      having.push(`${stat1T(statName)} = $${params.length}`);
    }

    if (diferencia) {
      if (conDiferencia) {
        params.push(Number(goles));
        having.push(`ABS(p.goles_local_1T - p.goles_visitante_1T) = $${params.length}`);
      }
    } else if (filtroActivo(goles)) {
      params.push(Number(goles));
      having.push(`(p.goles_local_1T + p.goles_visitante_1T) = $${params.length}`);
    }

    return { params, where, having };
  }

  _calcularDistribucion(rows) {
    const total = rows.reduce((acc, r) => acc + r.casos, 0);
    if (total === 0) return [];

    let menosAcumulado = 0;
    return rows.map((r) => {
      // Menos de N: partidos con menos de N (corners/goles). Más de N: el complemento, excluyendo los que tienen exactamente N.
      const menosDe = Math.round((menosAcumulado / total) * 100);
      const masDe = Math.round(((total - menosAcumulado - r.casos) / total) * 100);
      const partidosMenosDe = menosAcumulado;
      const partidosMasDe = total - menosAcumulado - r.casos;
      const partidosIgual = r.casos;
      menosAcumulado += r.casos;
      return {
        valor: r.valor,
        masDe,
        menosDe,
        partidos: total,
        partidosMasDe,
        partidosMenosDe,
        partidosIgual,
        partidosTotal: total,
        total,
        casos: r.casos,
      };
    });
  }

  async _distribucion(ligas, jornada, stat, goles, opciones, valorExp, groupBy, statName = "Corner kicks") {
    const { params, where, having } = this._buildFiltros(ligas, jornada, stat, goles, {
      ...opciones,
      statName,
    });

    const query = `
      SELECT
        valor,
        COUNT(*)::int AS casos
      FROM (
        SELECT
          p.id,
          ${valorExp} AS valor
        FROM estadisticas e
        JOIN partidos p ON p.id = e.partido_id
        WHERE ${where.join(" AND ")}
        GROUP BY ${groupBy}
        ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
      ) AS sub
      GROUP BY valor
      ORDER BY valor ASC;
    `;

    const { rows } = await pool.query(query, params);
    return this._calcularDistribucion(rows);
  }

  async getProbabilidadesCorners(ligas, jornada, corners, goles, opciones) {
    return this._distribucion(ligas, jornada, corners, goles, opciones, statTotal("Corner kicks"), "p.id");
  }

  async getProbabilidadesRemates(ligas, jornada, remates, goles, opciones) {
    return this._distribucion(
      ligas,
      jornada,
      remates,
      goles,
      opciones,
      statTotal("Total shots"),
      "p.id",
      "Total shots"
    );
  }

  async getProbabilidadesGoles(ligas, jornada, stat, goles, opciones, statName = "Corner kicks") {
    return this._distribucion(
      ligas,
      jornada,
      stat,
      goles,
      opciones,
      "(p.goles_local + p.goles_visitante)",
      "p.id, p.goles_local, p.goles_visitante",
      statName
    );
  }

  async getRoja1t(ligas, jornada, stat, goles) {
    const params = [];
    const where = [];

    if (ligas.length) {
      params.push(ligas);
      where.push(`p.liga = ANY($${params.length}::text[])`);
    }

    if (jornada > 0) {
      params.push(jornada);
      where.push(`p.fecha_jornada > $${params.length}`);
    }

    where.push(`e.nombre IN ('Corner kicks', 'Total shots')`);
    where.push(ROJA_1T_FILTER);

    const having = [];
    if (filtroActivo(stat)) {
      params.push(Number(stat));
      having.push(`${stat1T("Corner kicks")} = $${params.length}`);
    }
    if (filtroActivo(goles)) {
      params.push(Number(goles));
      having.push(`(p.goles_local_1T + p.goles_visitante_1T) = $${params.length}`);
    }

    const query = `
      SELECT
        p.id,
        p.liga,
        p.fecha_jornada,
        p.equipo_local,
        p.equipo_visitante,
        (p.goles_local_1T + p.goles_visitante_1T) AS goles_total_1t,
        ((p.goles_local - p.goles_local_1T) + (p.goles_visitante - p.goles_visitante_1T)) AS goles_total_2t,
        ${stat1T("Corner kicks")} AS corners_total_1t,
        ${stat2T("Corner kicks")} AS corners_total_2t,
        ${statTotal("Corner kicks")} AS total_corners,
        ${stat1T("Total shots")} AS remates_total_1t,
        ${stat2T("Total shots")} AS remates_total_2t,
        ${statTotal("Total shots")} AS total_remates
      FROM estadisticas e
      JOIN partidos p ON p.id = e.partido_id
      WHERE ${where.join(" AND ")}
      GROUP BY p.id, p.liga, p.fecha_jornada, p.equipo_local, p.equipo_visitante, p.goles_local, p.goles_visitante, p.goles_local_1T, p.goles_visitante_1T
      ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
      ORDER BY goles_total_1t DESC, total_corners DESC;
    `;

    const { rows } = await pool.query(query, params);
    return rows;
  }

  async getRoja1tCorners(ligas, jornada, stat, goles, opciones) {
    return this._distribucion(
      ligas,
      jornada,
      stat,
      goles,
      { ...opciones, roja1t: true },
      statTotal("Corner kicks"),
      "p.id"
    );
  }

  async getRoja1tRemates(ligas, jornada, stat, goles, opciones) {
    return this._distribucion(
      ligas,
      jornada,
      stat,
      goles,
      { ...opciones, roja1t: true },
      statTotal("Total shots"),
      "p.id",
      "Total shots"
    );
  }

  async getRoja1tGoles(ligas, jornada, stat, goles, opciones) {
    return this._distribucion(
      ligas,
      jornada,
      stat,
      goles,
      { ...opciones, roja1t: true },
      "(p.goles_local + p.goles_visitante)",
      "p.id, p.goles_local, p.goles_visitante"
    );
  }

  async getAnalisis2(ligas, jornada, corners, goles, conDiferencia) {
    const { params, where, having } = this._buildFiltros(ligas, jornada, corners, goles, {
      diferencia: true,
      conDiferencia,
    });

    const query = `
      SELECT
        p.liga,
        p.fecha_jornada,
        p.equipo_local,
        p.equipo_visitante,
        (p.goles_local_1T - p.goles_visitante_1T) AS diferencia_goles_1t,
        (p.goles_local_1T + p.goles_visitante_1T) AS goles_total_1t,
        ((p.goles_local - p.goles_local_1T) + (p.goles_visitante - p.goles_visitante_1T)) AS goles_total_2t,
        ${stat1T("Corner kicks")} AS corners_total_1t,
        ${stat2T("Corner kicks")} AS corners_total_2t,
        ${statTotal("Corner kicks")} AS total_corners
      FROM estadisticas e
      JOIN partidos p ON p.id = e.partido_id
      WHERE ${where.join(" AND ")}
      GROUP BY p.id, p.liga, p.fecha_jornada, p.equipo_local, p.equipo_visitante, p.goles_local, p.goles_visitante, p.goles_local_1T, p.goles_visitante_1T
      ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
      ORDER BY total_corners DESC;
    `;

    const { rows } = await pool.query(query, params);
    return rows;
  }

  async getAnalisis2Corners(ligas, jornada, corners, goles, conDiferencia) {
    return this.getProbabilidadesCorners(ligas, jornada, corners, goles, {
      diferencia: true,
      conDiferencia,
    });
  }

  async getAnalisis2Goles(ligas, jornada, corners, goles, conDiferencia) {
    return this.getProbabilidadesGoles(ligas, jornada, corners, goles, {
      diferencia: true,
      conDiferencia,
    });
  }

  _buildMarcadorFiltros(ligas, jornada, golesLocal1T, golesVisitante1T) {
    const params = [];
    const where = [];

    if (ligas.length) {
      params.push(ligas);
      where.push(`p.liga = ANY($${params.length}::text[])`);
    }

    if (jornada > 0) {
      params.push(jornada);
      where.push(`p.fecha_jornada > $${params.length}`);
    }

    if (golesLocal1T !== undefined && golesLocal1T !== null && golesLocal1T !== "") {
      params.push(Number(golesLocal1T));
      where.push(`p.goles_local_1T = $${params.length}`);
    }

    if (golesVisitante1T !== undefined && golesVisitante1T !== null && golesVisitante1T !== "") {
      params.push(Number(golesVisitante1T));
      where.push(`p.goles_visitante_1T = $${params.length}`);
    }

    return { params, where };
  }

  async getAnalisis3(ligas, jornada, golesLocal1T, golesVisitante1T) {
    const { params, where } = this._buildMarcadorFiltros(ligas, jornada, golesLocal1T, golesVisitante1T);

    const query = `
      SELECT
        p.liga,
        p.fecha_jornada,
        p.equipo_local,
        p.equipo_visitante,
        p.goles_local_1T,
        p.goles_visitante_1T,
        (p.goles_local - COALESCE(p.goles_local_1T, 0)) AS goles_local_2t,
        (p.goles_visitante - COALESCE(p.goles_visitante_1T, 0)) AS goles_visitante_2t,
        p.goles_local,
        p.goles_visitante,
        (p.goles_local + p.goles_visitante) AS goles_total
      FROM partidos p
      WHERE ${where.join(" AND ")}
      ORDER BY goles_total DESC;
    `;

    const { rows } = await pool.query(query, params);
    return rows;
  }

  async getAnalisis3Goles(ligas, jornada, golesLocal1T, golesVisitante1T) {
    const { params, where } = this._buildMarcadorFiltros(ligas, jornada, golesLocal1T, golesVisitante1T);

    const query = `
      SELECT
        goles_total AS valor,
        COUNT(*)::int AS casos
      FROM (
        SELECT
          p.id,
          (p.goles_local + p.goles_visitante) AS goles_total
        FROM partidos p
        WHERE ${where.join(" AND ")}
      ) AS sub
      GROUP BY goles_total
      ORDER BY goles_total ASC;
    `;

    const { rows } = await pool.query(query, params);
    return this._calcularDistribucion(rows);
  }

  _buildEquipoGolesFiltros(equipo, goles1T, ligas, jornada) {
    const params = [];
    const where = [];

    if (equipo) {
      params.push(equipo);
      where.push(`(p.equipo_local = $${params.length} OR p.equipo_visitante = $${params.length})`);
    }

    if (goles1T !== undefined && goles1T !== null && goles1T !== "") {
      params.push(Number(goles1T));
      where.push(`(p.goles_local_1T + p.goles_visitante_1T) = $${params.length}`);
    }

    if (ligas.length) {
      params.push(ligas);
      where.push(`p.liga = ANY($${params.length}::text[])`);
    }

    if (jornada > 0) {
      params.push(jornada);
      where.push(`p.fecha_jornada > $${params.length}`);
    }

    return { params, where };
  }

  async getGolesEquipo(equipo, goles1T, ligas, jornada) {
    const { params, where } = this._buildEquipoGolesFiltros(equipo, goles1T, ligas, jornada);

    const query = `
      SELECT
        p.id,
        p.liga,
        p.fecha_jornada,
        p.equipo_local,
        p.equipo_visitante,
        p.goles_local_1T,
        p.goles_visitante_1T,
        (p.goles_local - COALESCE(p.goles_local_1T, 0)) AS goles_local_2t,
        (p.goles_visitante - COALESCE(p.goles_visitante_1T, 0)) AS goles_visitante_2t,
        p.goles_local,
        p.goles_visitante,
        (p.goles_local + p.goles_visitante) AS goles_total
      FROM partidos p
      WHERE ${where.join(" AND ")}
      ORDER BY goles_total DESC;
    `;

    const { rows } = await pool.query(query, params);
    return rows;
  }

  async getGolesEquipoDistribucion(equipo, goles1T, ligas, jornada) {
    const { params, where } = this._buildEquipoGolesFiltros(equipo, goles1T, ligas, jornada);

    const query = `
      SELECT
        goles_total AS valor,
        COUNT(*)::int AS casos
      FROM (
        SELECT
          p.id,
          (p.goles_local + p.goles_visitante) AS goles_total
        FROM partidos p
        WHERE ${where.join(" AND ")}
      ) AS sub
      GROUP BY goles_total
      ORDER BY goles_total ASC;
    `;

    const { rows } = await pool.query(query, params);
    return this._calcularDistribucion(rows);
  }

  async getAnalisisEquipo1T(equipo, golesEquipo1T, ligas, jornada) {
    const params = [];
    const where = [];
    let idxEquipo = null;

    if (equipo) {
      params.push(equipo);
      idxEquipo = params.length;
      if (filtroActivo(golesEquipo1T)) {
        params.push(Number(golesEquipo1T));
        const idxGoles = params.length;
        where.push(
          `((p.equipo_local ILIKE '%' || $${idxEquipo} || '%' AND p.goles_local_1T = $${idxGoles}) OR (p.equipo_visitante ILIKE '%' || $${idxEquipo} || '%' AND p.goles_visitante_1T = $${idxGoles}))`
        );
      } else {
        where.push(`(p.equipo_local ILIKE '%' || $${idxEquipo} || '%' OR p.equipo_visitante ILIKE '%' || $${idxEquipo} || '%')`);
      }
    } else if (filtroActivo(golesEquipo1T)) {
      params.push(Number(golesEquipo1T));
      where.push(`(p.goles_local_1T + p.goles_visitante_1T) = $${params.length}`);
    }

    if (ligas.length) {
      params.push(ligas);
      where.push(`p.liga = ANY($${params.length}::text[])`);
    }

    if (jornada > 0) {
      params.push(jornada);
      where.push(`p.fecha_jornada > $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const eq = idxEquipo ? `$${idxEquipo}` : "''";

    const query = `
      SELECT
        p.id,
        p.liga,
        p.fecha_jornada,
        p.equipo_local,
        p.equipo_visitante,
        -- Equipo X (consultado) vs Equipo Y (rival)
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN p.equipo_local ELSE p.equipo_visitante END AS equipo_x,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN p.equipo_visitante ELSE p.equipo_local END AS equipo_y,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN 'Local' ELSE 'Visita' END AS condicion_x,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN true ELSE false END AS es_local_x,
        -- Goles local/visita originales (compat)
        p.goles_local_1T AS goles_local_1t,
        p.goles_visitante_1T AS goles_visitante_1t,
        (p.goles_local - COALESCE(p.goles_local_1T, 0)) AS goles_local_2t,
        (p.goles_visitante - COALESCE(p.goles_visitante_1T, 0)) AS goles_visitante_2t,
        (p.goles_local_1T + p.goles_visitante_1T) AS goles_total_1t,
        ((p.goles_local - COALESCE(p.goles_local_1T,0)) + (p.goles_visitante - COALESCE(p.goles_visitante_1T,0))) AS goles_total_2t,
        p.goles_local,
        p.goles_visitante,
        (p.goles_local + p.goles_visitante) AS goles_total,
        -- Goles X/Y
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN p.goles_local_1T ELSE p.goles_visitante_1T END AS goles_x_1t,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN p.goles_visitante_1T ELSE p.goles_local_1T END AS goles_y_1t,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN (p.goles_local - COALESCE(p.goles_local_1T,0)) ELSE (p.goles_visitante - COALESCE(p.goles_visitante_1T,0)) END AS goles_x_2t,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN (p.goles_visitante - COALESCE(p.goles_visitante_1T,0)) ELSE (p.goles_local - COALESCE(p.goles_local_1T,0)) END AS goles_y_2t,
        -- Remates local/visita
        COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Total shots' THEN e.valor_local::int END),0) AS remates_local_1t,
        COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Total shots' THEN e.valor_visitante::int END),0) AS remates_visitante_1t,
        (COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Total shots' THEN e.valor_local::int END),0) + COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Total shots' THEN e.valor_visitante::int END),0)) AS remates_total_1t,
        COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Total shots' THEN e.valor_local::int END),0) AS remates_local_2t,
        COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Total shots' THEN e.valor_visitante::int END),0) AS remates_visitante_2t,
        (COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Total shots' THEN e.valor_local::int END),0) + COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Total shots' THEN e.valor_visitante::int END),0)) AS remates_total_2t,
        -- Remates X/Y
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Total shots' THEN e.valor_local::int END),0) ELSE COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Total shots' THEN e.valor_visitante::int END),0) END AS remates_x_1t,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Total shots' THEN e.valor_visitante::int END),0) ELSE COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Total shots' THEN e.valor_local::int END),0) END AS remates_y_1t,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Total shots' THEN e.valor_local::int END),0) ELSE COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Total shots' THEN e.valor_visitante::int END),0) END AS remates_x_2t,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Total shots' THEN e.valor_visitante::int END),0) ELSE COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Total shots' THEN e.valor_local::int END),0) END AS remates_y_2t,
        -- Corners local/visita
        COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END),0) AS corners_local_1t,
        COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END),0) AS corners_visitante_1t,
        (COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END),0) + COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END),0)) AS corners_total_1t,
        COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END),0) AS corners_local_2t,
        COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END),0) AS corners_visitante_2t,
        (COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END),0) + COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END),0)) AS corners_total_2t,
        -- Corners X/Y
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END),0) ELSE COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END),0) END AS corners_x_1t,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END),0) ELSE COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END),0) END AS corners_y_1t,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END),0) ELSE COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END),0) END AS corners_x_2t,
        CASE WHEN p.equipo_local ILIKE '%' || ${eq} || '%' THEN COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END),0) ELSE COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END),0) END AS corners_y_2t
      FROM partidos p
      LEFT JOIN estadisticas e ON p.id = e.partido_id AND e.nombre IN ('Total shots','Corner kicks')
      ${whereSql}
      GROUP BY p.id, p.liga, p.fecha_jornada, p.equipo_local, p.equipo_visitante, p.goles_local, p.goles_visitante, p.goles_local_1T, p.goles_visitante_1T
      ORDER BY corners_total_1t DESC, p.fecha_jornada DESC;
    `;

    const { rows } = await pool.query(query, params);
    return rows;
  }
}

module.exports = { ProbabilidadesService };