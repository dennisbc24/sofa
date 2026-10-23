const pool = require("../db");

class PartidosService {
  async getPartidosByLiga(liga) {
    const query = "SELECT id, liga, fecha_jornada, fecha_partido, equipo_local, equipo_visitante, goles_local, goles_visitante, goles_local_1T, goles_visitante_1T, scrapeado_en FROM partidos WHERE liga = $1 ORDER BY fecha_partido DESC NULLS LAST, fecha_jornada DESC;";
    const { rows } = await pool.query(query, [liga]);
    return rows;
  }

  async getUltimosAgregados(liga) {
    const query = "SELECT id, liga, fecha_jornada, fecha_partido, equipo_local, equipo_visitante, goles_local, goles_visitante, scrapeado_en FROM partidos WHERE liga = $1 ORDER BY scrapeado_en DESC LIMIT 10;";
    const { rows } = await pool.query(query, [liga]);
    return rows;
  }

  async getPartidoById(id) {
    const query = "SELECT id, liga, fecha_jornada, fecha_partido, equipo_local, equipo_visitante, goles_local, goles_visitante, goles_local_1T, goles_visitante_1T, estado, scrapeado_en FROM partidos WHERE id = $1;";
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }

  async getEstadisticasByPartido(id) {
    const query = "SELECT id, partido_id, grupo, nombre, clave, periodo, valor_local, valor_visitante, valor_local_num, valor_visitante_num FROM estadisticas WHERE partido_id = $1 ORDER BY grupo, nombre, periodo;";
    const { rows } = await pool.query(query, [id]);
    return rows;
  }

  async getJugadoresByPartido(id) {
    const query = `
      SELECT equipo, nombre, posicion, dorsal, titular, capitan, jugo, minutos, rating,
             goles, asistencias, tiros, tiros_puerta, pases, pases_acertados, pases_clave,
             entradas, duelos_ganados, duelos_perdidos, recuperaciones, despejes, faltas, paradas,
             stats
      FROM jugadores
      WHERE partido_id = $1
      ORDER BY equipo, dorsal
    `;
    const { rows } = await pool.query(query, [id]);
    return rows;
  }

  async getGolesByPartido(id) {
    const query = `
      SELECT minuto, minuto_extra, minuto_texto, equipo, jugador_id, jugador,
             asistente_id, asistente, tipo, marcador_h, marcador_a, parte_cuerpo,
             situacion, ubicacion_arco
      FROM incidentes_goles
      WHERE partido_id = $1
      ORDER BY minuto
    `;
    const { rows } = await pool.query(query, [id]);
    return rows;
  }

  async getTarjetasByPartido(id) {
    const query = `
      SELECT minuto, minuto_extra, minuto_texto, equipo, jugador_id, jugador,
             tarjeta, motivo, anulada
      FROM incidentes_tarjetas
      WHERE partido_id = $1
      ORDER BY minuto
    `;
    const { rows } = await pool.query(query, [id]);
    return rows;
  }

  async getCambiosByPartido(id) {
    const query = `
      SELECT minuto, minuto_extra, minuto_texto, equipo, entra_id, entra,
             sale_id, sale, lesion
      FROM incidentes_cambios
      WHERE partido_id = $1
      ORDER BY minuto
    `;
    const { rows } = await pool.query(query, [id]);
    return rows;
  }

  async getRematesByPartido(id) {
    const query = `
      SELECT minuto, minuto_extra, minuto_texto, equipo, jugador_id, jugador,
             resultado, situacion, parte_cuerpo, xg, xgot, x, y,
             ubicacion_arco, arco_y, arco_z
      FROM remates
      WHERE partido_id = $1
      ORDER BY minuto
    `;
    const { rows } = await pool.query(query, [id]);
    return rows;
  }

  async getDescuentoByPartido(id) {
    const query = `
      SELECT descuento_1t, descuento_2t
      FROM incidentes_descuento
      WHERE partido_id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }
}

module.exports = { PartidosService };
