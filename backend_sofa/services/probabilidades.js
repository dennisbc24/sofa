const pool = require("../db");

const CORNERS_1T_TOTAL = `(
  COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END), 0)
  +
  COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END), 0)
)`;

const CORNERS_2T_TOTAL = `(
  COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END), 0)
  +
  COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END), 0)
)`;

const CORNERS_TOTAL = `(
  COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END), 0)
  +
  COALESCE(MAX(CASE WHEN e.periodo = '1ST' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END), 0)
  +
  COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END), 0)
  +
  COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END), 0)
)`;

class ProbabilidadesService {
  async getProbabilidades(ligas, jornada, corners, goles) {
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

    where.push(`e.nombre IN ('Corner kicks')`);

    if (corners > 0) {
      params.push(corners);
      having.push(`${CORNERS_1T_TOTAL} = $${params.length}`);
    }

    if (goles > 0) {
      params.push(goles);
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
        ${CORNERS_1T_TOTAL} AS corners_total_1t,
        (
          COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_local::int END), 0)
          +
          COALESCE(MAX(CASE WHEN e.periodo = '2ND' AND e.nombre = 'Corner kicks' THEN e.valor_visitante::int END), 0)
        ) AS corners_total_2t,
        ${CORNERS_TOTAL} AS total_corners
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

  _buildFiltros(
    ligas,
    jornada,
    corners,
    goles,
    { diferencia = false, conDiferencia = true } = {}
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

    where.push(`e.nombre IN ('Corner kicks')`);

    if (corners > 0) {
      params.push(corners);
      having.push(`${CORNERS_1T_TOTAL} = $${params.length}`);
    }

    if (diferencia) {
      if (conDiferencia) {
        params.push(goles);
        having.push(`ABS(p.goles_local_1T - p.goles_visitante_1T) = $${params.length}`);
      }
    } else if (goles > 0) {
      params.push(goles);
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
      menosAcumulado += r.casos;
      return {
        valor: r.valor,
        masDe,
        menosDe,
        partidos: total,
      };
    });
  }

  async _distribucion(ligas, jornada, corners, goles, opciones, valorExp, groupBy) {
    const { params, where, having } = this._buildFiltros(ligas, jornada, corners, goles, opciones);

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
    return this._distribucion(ligas, jornada, corners, goles, opciones, CORNERS_TOTAL, "p.id");
  }

  async getProbabilidadesGoles(ligas, jornada, corners, goles, opciones) {
    return this._distribucion(
      ligas,
      jornada,
      corners,
      goles,
      opciones,
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
        ${CORNERS_1T_TOTAL} AS corners_total_1t,
        ${CORNERS_2T_TOTAL} AS corners_total_2t,
        ${CORNERS_TOTAL} AS total_corners
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
}

module.exports = { ProbabilidadesService };