const pool = require("../db");

async function crearTablas() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Goles por minuto
    await client.query(`
      CREATE TABLE IF NOT EXISTS incidentes_goles (
        id SERIAL PRIMARY KEY,
        partido_id BIGINT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
        minuto INTEGER,
        minuto_extra INTEGER,
        minuto_texto TEXT,
        equipo TEXT CHECK (equipo IN ('home','away')),
        jugador_id TEXT,
        jugador TEXT,
        asistente_id TEXT,
        asistente TEXT,
        tipo TEXT,
        marcador_h INTEGER,
        marcador_a INTEGER,
        parte_cuerpo TEXT,
        situacion TEXT,
        ubicacion_arco TEXT,
        UNIQUE (partido_id, minuto, minuto_extra, equipo, jugador_id)
      );
    `);

    // Tarjetas
    await client.query(`
      CREATE TABLE IF NOT EXISTS incidentes_tarjetas (
        id SERIAL PRIMARY KEY,
        partido_id BIGINT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
        minuto INTEGER,
        minuto_extra INTEGER,
        minuto_texto TEXT,
        equipo TEXT CHECK (equipo IN ('home','away')),
        jugador_id TEXT,
        jugador TEXT,
        tarjeta TEXT CHECK (tarjeta IN ('yellow','red','second_yellow')),
        motivo TEXT,
        anulada BOOLEAN DEFAULT FALSE,
        UNIQUE (partido_id, minuto, minuto_extra, jugador_id)
      );
    `);

    // Cambios
    await client.query(`
      CREATE TABLE IF NOT EXISTS incidentes_cambios (
        id SERIAL PRIMARY KEY,
        partido_id BIGINT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
        minuto INTEGER,
        minuto_extra INTEGER,
        minuto_texto TEXT,
        equipo TEXT CHECK (equipo IN ('home','away')),
        entra_id TEXT,
        entra TEXT,
        sale_id TEXT,
        sale TEXT,
        lesion BOOLEAN DEFAULT FALSE,
        UNIQUE (partido_id, minuto, minuto_extra, entra_id, sale_id)
      );
    `);

    // Remates
    await client.query(`
      CREATE TABLE IF NOT EXISTS remates (
        id SERIAL PRIMARY KEY,
        partido_id BIGINT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
        minuto INTEGER,
        minuto_extra INTEGER,
        minuto_texto TEXT,
        equipo TEXT CHECK (equipo IN ('home','away')),
        jugador_id TEXT,
        jugador TEXT,
        resultado TEXT,
        situacion TEXT,
        parte_cuerpo TEXT,
        xg NUMERIC,
        xgot NUMERIC,
        x NUMERIC,
        y NUMERIC,
        ubicacion_arco TEXT,
        arco_y NUMERIC,
        arco_z NUMERIC,
        UNIQUE (partido_id, minuto, minuto_extra, jugador_id)
      );
    `);

    // Descuento por periodo
    await client.query(`
      CREATE TABLE IF NOT EXISTS incidentes_descuento (
        partido_id BIGINT PRIMARY KEY REFERENCES partidos(id) ON DELETE CASCADE,
        descuento_1t INTEGER,
        descuento_2t INTEGER
      );
    `);

    await client.query("COMMIT");
    console.log("Tablas creadas correctamente");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error creando tablas:", e);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

crearTablas().catch(e => { console.error(e); process.exit(1); });
