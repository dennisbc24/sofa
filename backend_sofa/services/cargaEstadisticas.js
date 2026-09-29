// ---------------------------------------------------------------------------
// CARGA DE ESTADISTICAS POR LOTE (JSON estilo Sofascore, uno por partido).
//
// Reglas (confirmadas con el usuario):
//  - Partido inexistente  -> se CREA desde el JSON (id = info.event.id).
//  - Partido existente CON estadisticas -> se SALTA (no se toca nada).
//  - Partido existente SIN estadisticas -> se rellenan SOLO los campos
//    vacios de la cabecera; nunca se pisan datos existentes.
//  - En estadisticas se respeta el indice UNIQUE (partido_id, periodo,
//    grupo, nombre) con ON CONFLICT DO NOTHING (subir 2 veces = idempotente).
//  - Transaccion por archivo: si un archivo falla, no deja datos a medias.
//  - Solo escribe en partidos/estadisticas; jamas toca otros modelos/tablas.
// ---------------------------------------------------------------------------
const pool = require("../db");

const COLS_STATS = [
  "partido_id", "periodo", "grupo", "nombre", "clave",
  "valor_local", "valor_visitante", "valor_local_num", "valor_visitante_num",
];

function aNumero(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Extrae cabecera + filas de stats de un JSON de Sofascore.
function transformar(json) {
  const ev = json && json.info && json.info.event;
  if (!ev || !ev.id) throw new Error("JSON sin info.event.id (no parece un dump de partido)");
  const stats = json.stats && Array.isArray(json.stats.statistics) ? json.stats.statistics : null;
  if (!stats) throw new Error("JSON sin stats.statistics (no trae estadisticas)");

  const ts = aNumero(ev.startTimestamp);
  const evento = {
    id: String(ev.id),
    local: (ev.homeTeam && ev.homeTeam.name) || null,
    visitante: (ev.awayTeam && ev.awayTeam.name) || null,
    fecha: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null,
    liga: (ev.tournament && ev.tournament.name) || (ev.season && ev.season.name) || null,
    jornada: (ev.roundInfo && aNumero(ev.roundInfo.round)) || null,
    golesLocal: ev.homeScore ? aNumero(ev.homeScore.current) : null,
    golesVisitante: ev.awayScore ? aNumero(ev.awayScore.current) : null,
    golesLocal1T: ev.homeScore ? aNumero(ev.homeScore.period1) : null,
    golesVisitante1T: ev.awayScore ? aNumero(ev.awayScore.period1) : null,
    estado: (ev.status && ev.status.description) || null,
  };
  if (!evento.local || !evento.visitante) throw new Error("JSON sin homeTeam/awayTeam.name");

  const filas = [];
  for (const bloque of stats) {
    const periodo = bloque.period;
    if (!periodo) continue;
    for (const grupo of bloque.groups || []) {
      for (const item of grupo.statisticsItems || []) {
        if (!item.name) continue;
        filas.push({
          periodo,
          grupo: grupo.groupName || "General",
          nombre: item.name,
          clave: item.key || null,
          valor_local: item.home != null ? String(item.home) : null,
          valor_visitante: item.away != null ? String(item.away) : null,
          // Si no trae homeValue numerico, se deriva del texto ("35%" -> 35).
          valor_local_num: item.homeValue != null ? aNumero(item.homeValue) : aNumero(String(item.home || "").replace("%", "")),
          valor_visitante_num: item.awayValue != null ? aNumero(item.awayValue) : aNumero(String(item.away || "").replace("%", "")),
        });
      }
    }
  }
  if (!filas.length) throw new Error("stats.statistics vacio (0 estadisticas)");
  return { evento, filas };
}

async function buscarPartido(ev, client) {
  // 1) Identificador exacto de Sofascore (mismo esquema que el scraper).
  let r = await client.query("SELECT id FROM partidos WHERE id = $1", [ev.id]);
  if (r.rows.length) return { id: String(r.rows[0].id), por: "id" };
  // 2) Pareja equipos + fecha (con tolerancia de +-1 dia por diferencias de zona).
  if (ev.local && ev.visitante && ev.fecha) {
    r = await client.query(
      `SELECT id FROM partidos
        WHERE equipo_local = $1 AND equipo_visitante = $2
          AND fecha_partido BETWEEN ($3::date - 1) AND ($3::date + 1)
        ORDER BY fecha_partido LIMIT 1`,
      [ev.local, ev.visitante, ev.fecha]
    );
    if (r.rows.length) return { id: String(r.rows[0].id), por: "equipos+fecha" };
  }
  return null;
}

// Rellena SOLO campos vacios de la cabecera del partido.
async function completarCabecera(ev, id, client) {
  await client.query(
    `UPDATE partidos SET
       equipo_local        = COALESCE(NULLIF(equipo_local, ''), $2),
       equipo_visitante    = COALESCE(NULLIF(equipo_visitante, ''), $3),
       fecha_partido       = COALESCE(fecha_partido, $4::date),
       liga                = COALESCE(NULLIF(liga, ''), $5),
       fecha_jornada       = COALESCE(fecha_jornada, $6),
       goles_local         = COALESCE(goles_local, $7),
       goles_visitante     = COALESCE(goles_visitante, $8),
       goles_local_1t      = COALESCE(goles_local_1t, $9),
       goles_visitante_1t  = COALESCE(goles_visitante_1t, $10),
       estado              = COALESCE(NULLIF(estado, ''), $11)
     WHERE id = $1`,
    [id, ev.local, ev.visitante, ev.fecha, ev.liga, ev.jornada,
     ev.golesLocal, ev.golesVisitante, ev.golesLocal1T, ev.golesVisitante1T, ev.estado]
  );
}

async function crearPartido(ev, client) {
  const r = await client.query(
    `INSERT INTO partidos
       (id, equipo_local, equipo_visitante, fecha_partido, liga, fecha_jornada,
        goles_local, goles_visitante, goles_local_1t, goles_visitante_1t, estado)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [ev.id, ev.local, ev.visitante, ev.fecha, ev.liga, ev.jornada,
     ev.golesLocal, ev.golesVisitante, ev.golesLocal1T, ev.golesVisitante1T, ev.estado]
  );
  return String(r.rows[0].id);
}

async function insertarStats(partidoId, filas, client) {
  let insertadas = 0;
  for (const f of filas) {
    const r = await client.query(
      `INSERT INTO estadisticas (${COLS_STATS.join(",")})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (partido_id, periodo, grupo, nombre) DO NOTHING`,
      [partidoId, f.periodo, f.grupo, f.nombre, f.clave,
       f.valor_local, f.valor_visitante, f.valor_local_num, f.valor_visitante_num]
    );
    insertadas += r.rowCount;
  }
  return insertadas;
}

// Asignación manual del lote: si el usuario eligió liga/jornada, sustituye a
// lo que traiga el JSON (solo cambia lo que se vaya a crear/completar; un
// partido existente con datos rellenados nunca se pisa — manda COALESCE).
function aplicarAsignacion(evento, opciones = {}) {
  const liga = typeof opciones.liga === "string" && opciones.liga.trim() ? opciones.liga.trim() : null;
  const jornada = Number.isInteger(opciones.jornada) && opciones.jornada > 0 ? opciones.jornada : null;
  if (liga) evento.liga = liga;
  if (jornada) evento.jornada = jornada;
}

// Procesa un archivo del lote. Nunca lanza: siempre devuelve un resultado.
async function procesarArchivo({ nombre, contenido }, opciones = {}) {
  const base = { archivo: nombre };
  let client;
  try {
    let json;
    try {
      json = JSON.parse(contenido);
    } catch {
      throw new Error("no es JSON valido");
    }
    const { evento, filas } = transformar(json);
    aplicarAsignacion(evento, opciones);

    client = await pool.connect();
    const partido = await buscarPartido(evento, client);

    if (partido) {
      const prev = await client.query(
        "SELECT EXISTS(SELECT 1 FROM estadisticas WHERE partido_id = $1) AS hay",
        [partido.id]
      );
      if (prev.rows[0].hay) {
        // Regla: si ya tiene stats, no se toca nada.
        return { ...base, partido_id: partido.id, partido: `${evento.local} vs ${evento.visitante}`,
                 liga: evento.liga, jornada: evento.jornada,
                 accion: "saltado", stats: 0, motivo: "el partido ya tiene estadisticas" };
      }
      await client.query("BEGIN");
      await completarCabecera(evento, partido.id, client);
      const n = await insertarStats(partido.id, filas, client);
      await client.query("COMMIT");
      return { ...base, partido_id: partido.id, partido: `${evento.local} vs ${evento.visitante}`,
               liga: evento.liga, jornada: evento.jornada,
               accion: "actualizado", stats: n, motivo: "cabecera existente completada" };
    }

    await client.query("BEGIN");
    const id = await crearPartido(evento, client);
    const n = await insertarStats(id, filas, client);
    await client.query("COMMIT");
    return { ...base, partido_id: id, partido: `${evento.local} vs ${evento.visitante}`,
             liga: evento.liga, jornada: evento.jornada,
             accion: "creado", stats: n };
  } catch (e) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* noop */ }
    }
    return { ...base, accion: "error", stats: 0, motivo: e.message };
  } finally {
    if (client) client.release();
  }
}

// files: [{nombre, contenido}]. opciones: { liga, jornada } = asignación manual
// de todo el lote (si viene, sustituye a lo del JSON; en partidos existentes
// con datos ya rellenados NUNCA se pisa — la regla COALESCE sigue mandando).
async function procesarLote(files, opciones = {}) {
  const resultados = [];
  for (const f of files) {
    resultados.push(await procesarArchivo(f, opciones));
  }
  const cuenta = (a) => resultados.filter((r) => r.accion === a).length;
  return {
    resultados,
    resumen: {
      archivos: resultados.length,
      creados: cuenta("creado"),
      actualizados: cuenta("actualizado"),
      saltados: cuenta("saltado"),
      errores: cuenta("error"),
      filas_insertadas: resultados.reduce((s, r) => s + (r.stats || 0), 0),
    },
  };
}

module.exports = { procesarLote, transformar, aplicarAsignacion };
