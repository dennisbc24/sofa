const pool = require("../db");

class PartidosService {
  async getPartidosByLiga(liga) {
    const query = "SELECT id, liga, fecha_jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, scrapeado_en FROM partidos WHERE liga = $1 ORDER BY fecha_jornada DESC;";
    const { rows } = await pool.query(query, [liga]);
    return rows;
  }

  async getUltimosAgregados(liga) {
    const query = "SELECT id, liga, fecha_jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, scrapeado_en FROM partidos WHERE liga = $1 ORDER BY scrapeado_en DESC LIMIT 10;";
    const { rows } = await pool.query(query, [liga]);
    return rows;
  }
}

module.exports = { PartidosService };
