import test from "node:test"
import assert from "node:assert/strict"
import {
  combinar2Partes,
  combinar3Partes,
  infoNuevaDe,
  filasPlanasDe,
  jugadoresDe,
  incidentesDe,
  fusionarIncidencias,
} from "../src/dosPartes.js"

const infoNueva = JSON.stringify({
  match_id: 123456,
  url: "https://www.sofascore.com/france-italy#id:123456",
  info: {
    home: "France",
    away: "Italy",
    goles_h: 2,
    goles_a: 1,
    goles_h_1T: 1,
    goles_a_1T: 0,
    fecha: "2025-06-15",
    estado: "Ended",
    torneo: "UEFA Nations League",
    ronda: 3,
    estadio: "Parc des Princes",
    arbitro: "Pepe",
  },
})

const statsNuevas = JSON.stringify({
  estadisticas: [
    { periodo: "ALL", grupo: "General", nombre: "Total shots", home: "5", away: "3", home_num: 5, away_num: 3 },
    { periodo: "ALL", grupo: "General", nombre: "Corner kicks", home: "4", away: "6", home_num: 4, away_num: 6 },
  ],
})

const players = JSON.stringify({
  jugadores: [
    { player_id: 1, nombre: "A", equipo: "home" },
    { player_id: 2, nombre: "B", equipo: "away" },
  ],
})

test("combinar3Partes genera un dump nuevo completo", () => {
  const r = combinar3Partes(infoNueva, statsNuevas, players)
  assert.equal(r.ok, true)
  assert.equal(r.partido.local, "France")
  assert.equal(r.partido.visitante, "Italy")
  assert.equal(r.partido.liga, "UEFA Nations League")
  assert.equal(r.partido.jugadores, 2)

  const out = JSON.parse(r.contenido)
  assert.equal(out.match_id, "123456")
  assert.equal(out.info.goles_h_1T, 1, "el marcador del 1T debe conservarse")
  assert.equal(out.estadisticas.length, 2)
  assert.equal(out.jugadores.length, 2)
})

test("combinar2Partes acepta el formato viejo (info.event + statistics)", () => {
  const infoVieja = JSON.stringify({
    info: {
      event: {
        id: 15534026,
        startTimestamp: 1750000000,
        homeTeam: { name: "France" },
        awayTeam: { name: "Italy" },
        homeScore: { current: 2, period1: 1 },
        awayScore: { current: 1, period1: 0 },
        status: { description: "Ended" },
        tournament: { name: "UEFA Nations League" },
        roundInfo: { round: 3 },
        venue: { name: "Parc des Princes" },
        referee: { name: "Pepe" },
      },
    },
  })
  const statsViejas = JSON.stringify({
    statistics: [
      {
        period: "1ST",
        groups: [
          {
            groupName: "Match overview",
            statisticsItems: [
              { name: "Total shots", home: "5", away: "3", homeValue: 5, awayValue: 3 },
              { name: "Ball possession", home: "55%", away: "45%" },
            ],
          },
        ],
      },
    ],
  })

  const r = combinar2Partes(infoVieja, statsViejas)
  assert.equal(r.ok, true)
  const out = JSON.parse(r.contenido)
  assert.equal(out.match_id, "15534026")
  assert.equal(out.info.home, "France")
  assert.equal(out.info.goles_h_1T, 1)
  assert.equal(out.info.estado, "Ended")
  assert.equal(out.estadisticas.length, 2)
  assert.equal(out.estadisticas[1].home_num, 55, "los porcentajes se convierten a número")
  assert.equal(out.estadisticas[0].periodo, "1ST")
})

test("combinar2Partes rechaza JSON inválido y stats vacías", () => {
  const malo = combinar2Partes("no json", statsNuevas)
  assert.equal(malo.ok, false)
  assert.match(malo.error, /no es JSON válido/)

  const sinStats = combinar2Partes(infoNueva, JSON.stringify({ estadisticas: [] }))
  assert.equal(sinStats.ok, false)
  assert.match(sinStats.error, /estadísticas/)

  const sinEquipos = combinar2Partes(JSON.stringify({ info: {} }), statsNuevas)
  assert.equal(sinEquipos.ok, false)
  assert.match(sinEquipos.error, /equipos/)
})

test("combinar3Partes rechaza players vacíos", () => {
  const r = combinar3Partes(infoNueva, statsNuevas, "{}")
  assert.equal(r.ok, false)
  assert.match(r.error, /jugadores/)
})

test("helpers normalizan info, filas y lineups de Sofascore", () => {
  const info = infoNuevaDe(JSON.parse(infoNueva))
  assert.equal(info.home, "France")
  assert.equal(info.goles_a, 1)

  assert.equal(filasPlanasDe(JSON.parse(statsNuevas)).length, 2)
  assert.equal(filasPlanasDe(null).length, 0)

  const lineups = jugadoresDe({
    home: { players: [{ player_id: 1, nombre: "A" }] },
    away: { players: [{ player_id: 2, nombre: "B" }] },
  })
  assert.deepEqual(
    lineups.map((p) => p.equipo),
    ["home", "away"]
  )
  assert.equal(jugadoresDe({ jugadores: [{ nombre: "C" }] }).length, 1)
  assert.equal(jugadoresDe(null).length, 0)
})

const incidentsRaw = JSON.stringify({
  home: { id: 1, name: "Iraq" },
  away: { id: 2, name: "Oman" },
  incidents: [
    {
      incidentType: "goal",
      incidentClass: "regular",
      isHome: true,
      time: 20,
      homeScore: 1,
      awayScore: 0,
      player: { id: 11, name: "A" },
      assist1: { id: 12, name: "B" },
    },
    {
      incidentType: "card",
      incidentClass: "yellow",
      isHome: false,
      time: 30,
      player: { id: 21, name: "C" },
    },
    {
      incidentType: "card",
      incidentClass: "red",
      isHome: false,
      time: 40,
      addedTime: 1,
      player: { id: 22, name: "D" },
    },
    {
      incidentType: "card",
      incidentClass: "yellowRed",
      isHome: true,
      time: 46,
    },
    { incidentType: "period", incidentClass: "period", isHome: true, time: 45, addedTime: 999 },
  ],
})

test("incidentesDe normaliza el feed crudo de incidents[]", () => {
  const inc = incidentesDe(JSON.parse(incidentsRaw))
  assert.equal(inc.goles.length, 1)
  assert.equal(inc.tarjetas.length, 3)
  assert.equal(inc.cambios.length, 0)

  const g = inc.goles[0]
  assert.deepEqual(
    { minuto: g.minuto, equipo: g.equipo, jugador_id: g.jugador_id, asistente_id: g.asistente_id },
    { minuto: 20, equipo: "home", jugador_id: "11", asistente_id: "12" }
  )
  assert.equal(g.marcador_h, 1)

  const roja = inc.tarjetas.find((t) => t.tarjeta === "red")
  assert.deepEqual(
    { minuto: roja.minuto, extra: roja.minuto_extra, texto: roja.minuto_texto, equipo: roja.equipo },
    { minuto: 40, extra: 1, texto: "40+1", equipo: "away" }
  )
  assert.equal(inc.tarjetas.find((t) => t.tarjeta === "second_yellow").equipo, "home")
  assert.equal(incidentesDe({ incidents: "no" }), null)
})

test("fusionarIncidencias añade tarjetas y goles al dump combinado", () => {
  const base = combinar2Partes(infoNueva, statsNuevas)
  assert.equal(base.ok, true)
  const r = fusionarIncidencias(base.contenido, incidentsRaw)
  assert.equal(r.ok, true)
  assert.equal(r.tarjetas, 3)
  assert.equal(r.goles, 1)

  const out = JSON.parse(r.contenido)
  assert.equal(out.info.home, "France", "conserva el dump original")
  assert.equal(out.incidentes.tarjetas.length, 3)
  assert.equal(out.incidentes.goles.length, 1)
  assert.equal(out.incidentes.tarjetas[1].tarjeta, "red")
  assert.equal(out.incidentes.descuento.h, undefined)
})

test("fusionarIncidencias respeta las incidencias que ya trae el dump", () => {
  const base = combinar2Partes(infoNueva, statsNuevas)
  const conInc = JSON.stringify({
    ...JSON.parse(base.contenido),
    incidentes: {
      tarjetas: [{ tarjeta: "red", minuto: 12, equipo: "home" }],
      goles: [],
      cambios: [],
      descuento: { h: 2, a: 1 },
    },
  })
  const r = fusionarIncidencias(conInc, incidentsRaw)
  assert.equal(r.ok, true)
  const out = JSON.parse(r.contenido)
  assert.equal(out.incidentes.tarjetas.length, 1)
  assert.equal(out.incidentes.tarjetas[0].minuto, 12)
  assert.deepEqual(out.incidentes.descuento, { h: 2, a: 1 })
})

test("fusionarIncidencias rechaza un incidents.json sin tarjetas ni goles", () => {
  const base = combinar2Partes(infoNueva, statsNuevas)
  const r = fusionarIncidencias(base.contenido, JSON.stringify({ incidents: [] }))
  assert.equal(r.ok, false)
  assert.match(r.error, /no trae incidencias/)
})
