const pool = require("../db");

class PartidosService {
  async getPartidosByLiga(liga) {
    const query = "SELECT id, liga, fecha_jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, goles_local_1T, goles_visitante_1T, scrapeado_en FROM partidos WHERE liga = $1 ORDER BY fecha_jornada DESC;";
    const { rows } = await pool.query(query, [liga]);
    return rows;
  }

  async getUltimosAgregados(liga) {
    const query = "SELECT id, liga, fecha_jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, scrapeado_en FROM partidos WHERE liga = $1 ORDER BY scrapeado_en DESC LIMIT 10;";
    const { rows } = await pool.query(query, [liga]);
    return rows;
  }

  async getPartidoById(id) {
    const query = "SELECT id, liga, fecha_jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, goles_local_1T, goles_visitante_1T, estado, scrapeado_en FROM partidos WHERE id = $1;";
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }

  async getEstadisticasByPartido(id) {
    const query = "SELECT id, partido_id, grupo, nombre, clave, periodo, valor_local, valor_visitante, valor_local_num, valor_visitante_num FROM estadisticas WHERE partido_id = $1 ORDER BY grupo, nombre, periodo;";
    const { rows } = await pool.query(query, [id]);
    return rows;
  }
}

module.exports = { PartidosService };
