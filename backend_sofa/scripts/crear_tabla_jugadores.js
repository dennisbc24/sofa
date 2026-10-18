// Crea la tabla `jugadores` (stats por jugador, dump nuevo de Sofascore).
//
// Uso:
//   node scripts/crear_tabla_jugadores.js
//
// Es idempotente (CREATE TABLE IF NOT EXISTS) y solo crea la tabla:
// no toca filas de partidos/estadisticas ni otros modelos/tablas.
// PK (partido_id, equipo, player_id) + ON CONFLICT DO NOTHING en la carga:
// re-subir el mismo partido no duplica jugadores.

const pool = require("../db");

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jugadores (
      partido_id   TEXT NOT NULL,
      equipo       TEXT NOT NULL,              -- 'home' | 'away'
      player_id    TEXT NOT NULL,              -- id Sofascore; si falta, 'nombre:<nombre>'
      nombre       TEXT,
      posicion     TEXT,                        -- G | D | M | F
      dorsal       INTEGER,
      titular      BOOLEAN,
      capitan      BOOLEAN,
      jugo         BOOLEAN,                     -- entro a jugar (aunque sea 1 minuto)
      minutos      INTEGER,
      rating       NUMERIC,
      goles        INTEGER,
      asistencias  INTEGER,
      xg           NUMERIC,
      xa           NUMERIC,
      tiros        INTEGER,
      tiros_puerta INTEGER,
      pases        INTEGER,
      pases_acertados INTEGER,
      pases_clave  INTEGER,
      entradas     INTEGER,
      duelos_ganados  INTEGER,
      duelos_perdidos INTEGER,
      recuperaciones  INTEGER,
      despejes     INTEGER,
      aereos_ganados INTEGER,
      faltas       INTEGER,
      paradas      INTEGER,                     -- saves (portero)
      km           NUMERIC,
      toques       INTEGER,
      valor_pase      NUMERIC,                 -- passValueNormalized
      valor_regate    NUMERIC,                 -- dribbleValueNormalized
      valor_defensa   NUMERIC,                 -- defensiveValueNormalized
      valor_portero   NUMERIC,                 -- goalkeeperValueNormalized
      valor_porteria_cero NUMERIC,             -- keeperSaveValue
      stats        JSONB,                      -- objeto crudo completo del jugador
      PRIMARY KEY (partido_id, equipo, player_id)
    )
  `);
  console.log("tabla jugadores lista");
  await pool.end();
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
