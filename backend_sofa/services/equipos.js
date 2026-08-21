const pool = require("../db");

class EquiposService {
  async getEquipos() {
    const query = `
      SELECT DISTINCT nombre
      FROM (
        SELECT equipo_local AS nombre FROM partidos WHERE equipo_local IS NOT NULL
        UNION
        SELECT equipo_visitante FROM partidos WHERE equipo_visitante IS NOT NULL
      ) equipos
      ORDER BY nombre;
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  async getLigas(equipo) {
    const query = `
      SELECT DISTINCT liga
      FROM partidos
      WHERE (equipo_local = $1 OR equipo_visitante = $1) AND liga IS NOT NULL
      ORDER BY liga;
    `;
    const { rows } = await pool.query(query, [equipo]);
    return rows.map((r) => r.liga);
  }

  async getPromediosGoles(equipo, liga) {
    const params = [equipo];
    let ligaFilter = "";
    if (liga) {
      params.push(liga);
      ligaFilter = ` AND p.liga = $${params.length}`;
    }

    const query = `
      SELECT
        COUNT(*)::int AS partidos,
        ROUND(AVG(
          CASE WHEN p.equipo_local = $1 THEN p.goles_local ELSE p.goles_visitante END
        )::numeric, 2) AS goles_favor,
        ROUND(AVG(
          CASE WHEN p.equipo_local = $1 THEN p.goles_visitante ELSE p.goles_local END
        )::numeric, 2) AS goles_contra,
        COUNT(*) FILTER (
          WHERE
            (p.equipo_local = $1 AND p.goles_local > p.goles_visitante)
            OR (p.equipo_visitante = $1 AND p.goles_visitante > p.goles_local)
        )::int AS victorias,
        COUNT(*) FILTER (WHERE p.goles_local = p.goles_visitante)::int AS empates,
        COUNT(*) FILTER (
          WHERE
            (p.equipo_local = $1 AND p.goles_local < p.goles_visitante)
            OR (p.equipo_visitante = $1 AND p.goles_visitante < p.goles_local)
        )::int AS derrotas
      FROM partidos p
      WHERE (p.equipo_local = $1 OR p.equipo_visitante = $1)
        AND p.estado = 'Ended'${ligaFilter};
    `;
    const { rows } = await pool.query(query, params);
    return rows[0];
  }

  async getPromediosEstadisticas(equipo, liga) {
    const params = [equipo];
    let ligaFilter = "";
    if (liga) {
      params.push(liga);
      ligaFilter = ` AND p.liga = $${params.length}`;
    }

    // Extrae el número del texto: para porcentajes usa el valor antes del "%",
    // para el resto usa valor_*_num. Evita promediar números crudos mal mapeados.
    const valorLocal = `
      CASE WHEN POSITION('%' IN e.valor_local) > 0
        THEN NULLIF(substring(e.valor_local from '([0-9]+(\\.[0-9]+)?)%'), '')::numeric
        ELSE e.valor_local_num
      END`;
    const valorVisitante = `
      CASE WHEN POSITION('%' IN e.valor_visitante) > 0
        THEN NULLIF(substring(e.valor_visitante from '([0-9]+(\\.[0-9]+)?)%'), '')::numeric
        ELSE e.valor_visitante_num
      END`;

    const query = `
      WITH valores AS (
        SELECT
          e.grupo,
          e.nombre,
          e.clave,
          e.periodo,
          CASE WHEN p.equipo_local = $1 THEN ${valorLocal} ELSE ${valorVisitante} END AS valor
        FROM estadisticas e
        JOIN partidos p ON p.id = e.partido_id
        WHERE (p.equipo_local = $1 OR p.equipo_visitante = $1)
          AND e.clave IS NOT NULL
          AND e.periodo = 'ALL'${ligaFilter}
      )
      SELECT
        grupo,
        nombre,
        clave,
        ROUND(AVG(valor)::numeric, 2) AS promedio,
        COUNT(*)::int AS n
      FROM valores
      WHERE valor IS NOT NULL
      GROUP BY grupo, nombre, clave
      ORDER BY grupo, nombre;
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  }
}

module.exports = { EquiposService };