// ---------------------------------------------------------------------------
// SUBIDA EN PARTES (extracto del celular): muchos extractores sólo pueden
// guardar info.json, stats.json y players.json por separado. Estas funciones
// normalizan cada parte y las combinan en un dump del formato NUEVO
// { match_id, url, info, estadisticas, jugadores } — el mismo formato que
// genera el escritorio, así el celular y el desktop producen lo mismo.
//
// Formas aceptadas de la PARTE info:
//  - { info: { home, away, goles_h, ... } }  (formato nuevo)
//  - { info: { event } }                     (formato viejo, ya envuelto)
//  - { event: {...} } / { id, homeTeam, ... } (respuesta cruda de /event/{id})
// Formas aceptadas de la PARTE stats:
//  - { estadisticas: [ { periodo, grupo, nombre, ... } ] }  (formato nuevo, plana)
//  - { statistics: [ { period, groups } ] }                (respuesta de /statistics)
//  - { stats: { statistics } } / { statistic: [...] }      (API vieja)
// Formas aceptadas de la PARTE players:
//  - { jugadores: [...] }  /  { players: [...] }  /  [ ... ]
// ---------------------------------------------------------------------------

const num = (v) => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const isoFecha = (ts) => {
  const n = num(ts)
  return n ? new Date(n * 1000).toISOString().slice(0, 10) : null
}

// --- PARTE info -------------------------------------------------------------

// Evento del formato viejo (o respuesta cruda de /event/{id}).
export const eventoDeInfo = (j) => {
  if (j && j.info && j.info.event) return j.info.event
  if (j && j.event && j.event.id) return j.event
  if (j && j.id && j.homeTeam && j.awayTeam) return j
  return null
}

// Normaliza la parte info al objeto info del formato nuevo.
export const infoNuevaDe = (j) => {
  if (!j) return null
  if (j.info && (j.info.home || j.info.away)) return j.info
  const ev = eventoDeInfo(j)
  if (!ev || !ev.id) return null
  return {
    home: (ev.homeTeam && ev.homeTeam.name) || null,
    away: (ev.awayTeam && ev.awayTeam.name) || null,
    goles_h: ev.homeScore ? num(ev.homeScore.current) : null,
    goles_a: ev.awayScore ? num(ev.awayScore.current) : null,
    goles_h_1T: ev.homeScore ? num(ev.homeScore.period1) : null,
    goles_a_1T: ev.awayScore ? num(ev.awayScore.period1) : null,
    fecha: isoFecha(ev.startTimestamp),
    estado: (ev.status && ev.status.description) || null,
    torneo: (ev.tournament && ev.tournament.name) || null,
    ronda: num(ev.roundInfo && ev.roundInfo.round),
    estadio: (ev.venue && ev.venue.name) || null,
    arbitro: (ev.referee && ev.referee.name) || null,
  }
}

// id del partido y url (para el archivo combinado).
const idYUrlDe = (j) => {
  if (!j) return { id: null, url: null }
  if (j.match_id != null) return { id: String(j.match_id), url: j.url || null }
  const info = j.info || {}
  if (info.event && info.event.id) {
    return { id: String(info.event.id), url: null }
  }
  const ev = eventoDeInfo(j)
  if (ev && ev.id) return { id: String(ev.id), url: null }
  const u = typeof j.url === "string" ? j.url : ""
  const m = u.match(/#id:(\d+)/)
  return { id: m ? m[1] : null, url: j.url || null }
}

// --- PARTE stats ------------------------------------------------------------

export const statisticsDeStats = (j) => {
  if (j && j.stats && Array.isArray(j.stats.statistics)) return j.stats.statistics
  if (j && Array.isArray(j.statistics)) return j.statistics
  if (j && Array.isArray(j.statistic)) return j.statistic
  return null
}

// Normaliza la parte stats a filas planas del formato nuevo:
// [{ periodo, grupo, nombre, clave, home, away, home_num, away_num }]
export const filasPlanasDe = (j) => {
  if (!j) return []
  // Formato nuevo: ya viene plano.
  if (Array.isArray(j.estadisticas)) return j.estadisticas.filter((f) => f && f.nombre)
  const arr = statisticsDeStats(j)
  if (!Array.isArray(arr) || !arr.length) return []
  const filas = []
  // Forma agrupada: [{ period, groups: [{ groupName, statisticsItems }] }]
  if (arr[0] && Array.isArray(arr[0].groups)) {
    for (const bloque of arr) {
      const periodo = bloque.period || "ALL"
      for (const grupo of bloque.groups || []) {
        for (const item of grupo.statisticsItems || grupo.statisticsList || []) {
          if (!item || !item.name) continue
          filas.push({
            periodo,
            grupo: (grupo && grupo.groupName) || "General",
            nombre: item.name,
            clave: item.key || null,
            home: item.home != null ? String(item.home) : null,
            away: item.away != null ? String(item.away) : null,
            home_num: item.homeValue != null ? num(item.homeValue) : num(String(item.home ?? "").replace("%", "")),
            away_num: item.awayValue != null ? num(item.awayValue) : num(String(item.away ?? "").replace("%", "")),
          })
        }
      }
    }
    return filas
  }
  // Forma plana vieja: [{ period, name, home, away }]
  for (const item of arr) {
    if (!item || !item.name) continue
    filas.push({
      periodo: item.period || "ALL",
      grupo: item.groupName || "General",
      nombre: item.name,
      clave: item.key || null,
      home: item.home != null ? String(item.home) : null,
      away: item.away != null ? String(item.away) : null,
      home_num: item.homeValue != null ? num(item.homeValue) : num(String(item.home ?? "").replace("%", "")),
      away_num: item.awayValue != null ? num(item.awayValue) : num(String(item.away ?? "").replace("%", "")),
    })
  }
  return filas
}

// --- PARTE players ----------------------------------------------------------

export const jugadoresDe = (j) => {
  if (!j) return []
  if (Array.isArray(j)) return j
  if (Array.isArray(j.jugadores)) return j.jugadores
  if (Array.isArray(j.players)) return j.players
  // Lineups de Sofascore: { home: { players: [...] }, away: { players: [...] } }
  if (j.home && Array.isArray(j.home.players)) {
    return [
      ...j.home.players.map((p) => ({ ...p, equipo: "home" })),
      ...(j.away && Array.isArray(j.away.players)
        ? j.away.players.map((p) => ({ ...p, equipo: "away" }))
        : []),
    ]
  }
  return []
}

// --- Combinación ------------------------------------------------------------

const parsear = (contenido, etiqueta) => {
  try {
    return JSON.parse(contenido)
  } catch {
    return { error: `${etiqueta} no es JSON válido.` }
  }
}

// Combina info + stats en un dump del formato nuevo.
// Devuelve { ok: true, contenido, partido } o { ok: false, error }.
export const combinar2Partes = (infoContenido, statsContenido) => {
  const ji = parsear(infoContenido, "info.json")
  if (ji.error) return { ok: false, error: ji.error }
  const info = infoNuevaDe(ji)
  if (!info || (!info.home && !info.away)) {
    return { ok: false, error: "info.json no trae los equipos (se espera info con home/away o info.event)." }
  }
  const js = parsear(statsContenido, "stats.json")
  if (js.error) return { ok: false, error: js.error }
  const estadisticas = filasPlanasDe(js)
  if (!estadisticas.length) {
    return { ok: false, error: "stats.json no trae estadísticas (se espera estadisticas/statistics/statistic con datos)." }
  }
  const { id, url } = idYUrlDe(ji)
  const partido = {
    id: id || null,
    local: info.home || null,
    visitante: info.away || null,
    fecha: info.fecha || null,
    liga: info.torneo || null,
    alDescanso: info.estado || null,
  }
  const contenido = JSON.stringify({
    ...(id ? { match_id: id } : {}),
    ...(url ? { url } : {}),
    info,
    estadisticas,
    jugadores: [],
  })
  return { ok: true, contenido, partido }
}

// Combina info + stats + players en un dump del formato nuevo.
export const combinar3Partes = (infoContenido, statsContenido, jugadoresContenido) => {
  const base = combinar2Partes(infoContenido, statsContenido)
  if (!base.ok) return base
  const jp = parsear(jugadoresContenido, "players.json")
  if (jp.error) return { ok: false, error: jp.error }
  const jugadores = jugadoresDe(jp)
  if (!jugadores.length) {
    return { ok: false, error: "players.json no trae jugadores (se espera jugadores/players o un array)." }
  }
  const ji = parsear(infoContenido, "info.json")
  const { id, url } = idYUrlDe(ji)
  const info = infoNuevaDe(ji)
  const contenido = JSON.stringify({
    ...(id ? { match_id: id } : {}),
    ...(url ? { url } : {}),
    info,
    estadisticas: filasPlanasDe(parsear(statsContenido, "stats.json")),
    jugadores,
  })
  return {
    ok: true,
    contenido,
    partido: {
      ...base.partido,
      jugadores: jugadores.length,
    },
  }
}

// --- PARTE incidencias (feed crudo de Sofascore) ----------------------------
// El móvil suele guardar sólo la respuesta de /event/{id}/incidents:
// { incidents: [...], home: {...}, away: {...} }. Se convierte al bloque
// `incidentes` del dump nuevo (mismas claves que cargaEstadisticas/DB).

const tarjetaNormalizada = (clase) => {
  const c = String(clase || "").toLowerCase()
  if (c === "red") return "red"
  if (c === "yellowred" || c === "secondyellow" || c === "second_yellow") return "second_yellow"
  if (c === "yellow") return "yellow"
  return null
}

export const incidentesDe = (j) => {
  if (!j) return null
  // Ya viene normalizado (mismo formato que el dump del escritorio).
  if (j.incidentes && typeof j.incidentes === "object") {
    return {
      goles: Array.isArray(j.incidentes.goles) ? j.incidentes.goles : [],
      tarjetas: Array.isArray(j.incidentes.tarjetas) ? j.incidentes.tarjetas : [],
      cambios: Array.isArray(j.incidentes.cambios) ? j.incidentes.cambios : [],
      descuento: j.incidentes.descuento || {},
    }
  }
  const arr = j.incidents
  if (!Array.isArray(arr)) return null

  const goles = []
  const tarjetas = []
  for (const x of arr) {
    if (!x || !x.incidentType) continue
    const minuto = num(x.time)
    const extra = num(x.addedTime)
    const minutoExtra = extra !== null && extra !== 999 ? extra : null
    const texto = minuto === null ? null : `${minuto}${minutoExtra !== null ? `+${minutoExtra}` : ""}`
    const equipo = x.isHome === true ? "home" : x.isHome === false ? "away" : null
    if (!equipo) continue

    if (x.incidentType === "goal") {
      goles.push({
        minuto,
        minuto_extra: minutoExtra,
        minuto_texto: texto,
        equipo,
        jugador_id: x.player && x.player.id != null ? String(x.player.id) : null,
        jugador: (x.player && x.player.name) || null,
        asistente_id: x.assist1 && x.assist1.id != null ? String(x.assist1.id) : null,
        asistente: (x.assist1 && x.assist1.name) || null,
        tipo: x.incidentClass || "regular",
        marcador_h: num(x.homeScore),
        marcador_a: num(x.awayScore),
        parte_cuerpo: null,
        situacion: null,
        ubicacion_arco: null,
      })
    } else if (x.incidentType === "card") {
      const tarjeta = tarjetaNormalizada(x.incidentClass)
      if (!tarjeta) continue
      tarjetas.push({
        minuto,
        minuto_extra: minutoExtra,
        minuto_texto: texto,
        equipo,
        jugador_id: x.player && x.player.id != null ? String(x.player.id) : null,
        jugador: (x.player && x.player.name) || null,
        tarjeta,
        motivo: x.incidentClass || null,
        anulada: false,
      })
    }
  }
  return { goles, tarjetas, cambios: [], descuento: {} }
}

// Añade las incidencias a un dump ya combinado. No pisa las que ya trae el
// dump (el archivo de escritorio ya las incluye).
export const fusionarIncidencias = (dumpContenido, incidentesContenido) => {
  const jd = parsear(dumpContenido, "dump del partido")
  if (jd.error) return { ok: false, error: jd.error }
  const ji = parsear(incidentesContenido, "incidents.json")
  if (ji.error) return { ok: false, error: ji.error }

  const inc = incidentesDe(ji)
  if (!inc || (!inc.tarjetas.length && !inc.goles.length)) {
    return {
      ok: false,
      error: "incidents.json no trae incidencias (se espera incidents/incidentes con tarjetas o goles).",
    }
  }

  const actual = jd.incidentes || {}
  const tarjetas = Array.isArray(actual.tarjetas) && actual.tarjetas.length ? actual.tarjetas : inc.tarjetas
  const goles = Array.isArray(actual.goles) && actual.goles.length ? actual.goles : inc.goles
  const cambios = Array.isArray(actual.cambios) && actual.cambios.length ? actual.cambios : inc.cambios
  const descuento = actual.descuento && Object.keys(actual.descuento).length ? actual.descuento : inc.descuento

  const contenido = JSON.stringify({
    ...jd,
    incidentes: { goles, tarjetas, cambios, descuento },
  })
  return { ok: true, contenido, tarjetas: tarjetas.length, goles: goles.length }
}
