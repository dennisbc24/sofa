// ---------------------------------------------------------------------------
// SUBIDA EN 2 PARTES (extracto del celular): muchos extractores sólo pueden
// guardar info.json (evento) y stats.json (estadísticas) por separado. Estas
// funciones normalizan formas habituales de cada parte y las combinan en un
// dump completo { info: { event }, stats: { statistics } } — el mismo formato
// que recibe el backend de la proyección 2T.
// ---------------------------------------------------------------------------

// Formas aceptadas de la PARTE info:
//  - { info: { event } }   (ya envuelta, como en un dump completo)
//  - { event: {...} }      (respuesta cruda de /event/{id})
//  - { id, homeTeam, awayTeam, ... }  (el objeto evento pelado)
export const eventoDeInfo = (j) => {
  if (j && j.info && j.info.event) return j.info.event
  if (j && j.event && j.event.id) return j.event
  if (j && j.id && j.homeTeam && j.awayTeam) return j
  return null
}

// Formas aceptadas de la PARTE stats:
//  - { statistics: [ { period, groups } ] }   (respuesta de /statistics)
//  - { stats: { statistics } }                (ya envuelta)
//  - { statistic: [ { period, name, home, away } ] }  (API vieja, plana)
export const statisticsDeStats = (j) => {
  if (j && j.stats && Array.isArray(j.stats.statistics)) return j.stats.statistics
  if (j && Array.isArray(j.statistics)) return j.statistics
  if (j && Array.isArray(j.statistic)) return j.statistic
  return null
}

// Normaliza a [{ period, groups: [{ groupName, statisticsItems }] }]:
// acepta la forma agrupada (statisticsItems o statisticsList) o la plana.
export const aGrupos = (arr) => {
  if (!Array.isArray(arr) || !arr.length) return []
  if (arr[0] && Array.isArray(arr[0].groups)) {
    return arr
      .filter((b) => b && Array.isArray(b.groups))
      .map((b) => ({
        period: b.period || "ALL",
        groups: b.groups.map((g) => ({
          groupName: (g && g.groupName) || "General",
          statisticsItems: (g && (g.statisticsItems || g.statisticsList)) || [],
        })),
      }))
  }
  // Forma plana: se reagrupa por periodo.
  const porPeriodo = new Map()
  for (const it of arr) {
    if (!it || !it.name) continue
    const p = it.period || "ALL"
    if (!porPeriodo.has(p)) porPeriodo.set(p, [])
    porPeriodo.get(p).push({
      name: it.name,
      key: it.key || null,
      home: it.home,
      away: it.away,
      homeValue: it.homeValue,
      awayValue: it.awayValue,
    })
  }
  return [...porPeriodo].map(([period, statisticsItems]) => ({
    period,
    groups: [{ groupName: "General", statisticsItems }],
  }))
}

// Combina las dos partes en un dump completo.
// Devuelve { ok: true, contenido, partido } o { ok: false, error }.
export const combinar2Partes = (infoContenido, statsContenido) => {
  let ji
  try {
    ji = JSON.parse(infoContenido)
  } catch {
    return { ok: false, error: "info.json no es JSON válido." }
  }
  const ev = eventoDeInfo(ji)
  if (!ev || !ev.id) {
    return { ok: false, error: "info.json no trae el evento (se espera info.event, event o el evento con id)." }
  }
  if (!ev.homeTeam || !ev.homeTeam.name || !ev.awayTeam || !ev.awayTeam.name) {
    return { ok: false, error: "info.json sin homeTeam/awayTeam.name (no se identifican los equipos)." }
  }

  let js
  try {
    js = JSON.parse(statsContenido)
  } catch {
    return { ok: false, error: "stats.json no es JSON válido." }
  }
  const statistics = aGrupos(statisticsDeStats(js))
  if (!statistics.length) {
    return { ok: false, error: "stats.json no trae estadísticas (se espera statistics/statistic con datos)." }
  }

  const contenido = JSON.stringify({
    info: { event: ev },
    stats: { statistics },
  })
  return {
    ok: true,
    contenido,
    partido: {
      id: String(ev.id),
      local: ev.homeTeam.name,
      visitante: ev.awayTeam.name,
      fecha: ev.startTimestamp
        ? new Date(ev.startTimestamp * 1000).toISOString().slice(0, 10)
        : null,
      liga: (ev.tournament && ev.tournament.name) || null,
      alDescanso: (ev.status && ev.status.description) || null,
    },
  }
}
