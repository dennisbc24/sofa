// Test de dosPartes.js: combinar 2 y 3 partes con las formas reales.
import { combinar2Partes, combinar3Partes, infoNuevaDe, filasPlanasDe, jugadoresDe } from "../src/dosPartes.js"
import fs from "fs"

const dir = "C:/Users/LENOVO/Documents/proyects/sofa/muestra/"
const f = fs.readdirSync(dir)[0]
const j = JSON.parse(fs.readFileSync(dir + f, "utf8"))

console.log("== 3 partes con un dump real partido en info/stats/players ==")
const infoC = JSON.stringify({ match_id: j.match_id, url: j.url, info: j.info })
const statsC = JSON.stringify({ estadisticas: j.estadisticas })
const playersC = JSON.stringify({ jugadores: j.jugadores })
const r3 = combinar3Partes(infoC, statsC, playersC)
console.log("ok:", r3.ok, "| partido:", JSON.stringify(r3.partido))
const out = JSON.parse(r3.contenido)
console.log("claves:", Object.keys(out))
console.log("info:", JSON.stringify(out.info).slice(0, 130))
console.log("filas:", out.estadisticas.length, "| jugadores:", out.jugadores.length)
console.log("1T preservado:", out.info.goles_h_1T, "-", out.info.goles_a_1T)

console.log("\n== 2 partes (info + stats) ==")
const r2 = combinar2Partes(infoC, statsC)
console.log("ok:", r2.ok, "| partido:", JSON.stringify(r2.partido))
const out2 = JSON.parse(r2.contenido)
console.log("claves:", Object.keys(out2), "| jugadores:", out2.jugadores.length)

console.log("\n== formato viejo: info.event + statistics agrupadas ==")
const evento = {
  id: 15534026, startTimestamp: 1750000000,
  homeTeam: { name: "France" }, awayTeam: { name: "Italy" },
  homeScore: { current: 2, period1: 1 }, awayScore: { current: 1, period1: 0 },
  status: { type: "finished", description: "Ended" },
  tournament: { name: "UEFA Nations League" }, roundInfo: { round: 3 },
  venue: { name: "Parc des Princes" }, referee: { name: "Pepe" },
}
const infoViejo = JSON.stringify({ info: { event: evento } })
const statsViejo = JSON.stringify({
  statistics: [{ period: "1ST", groups: [{ groupName: "Match overview", statisticsItems: [
    { name: "Total shots", key: "totalShotsOnGoal", home: "5", away: "3", homeValue: 5, awayValue: 3 },
    { name: "Ball possession", key: "ballPossession", home: "55%", away: "45%" },
  ] }] }],
})
const rViejo = combinar2Partes(infoViejo, statsViejo)
console.log("ok:", rViejo.ok, "| partido:", JSON.stringify(rViejo.partido))
const outV = JSON.parse(rViejo.contenido)
console.log("info normalizada:", JSON.stringify(outV.info))
console.log("filas:", JSON.stringify(outV.estadisticas))

console.log("\n== lineups de Sofascore (home.players / away.players) ==")
console.log("jugadores:", jugadoresDe({ home: { players: [{ player_id: 1, nombre: "A" }] }, away: { players: [{ player_id: 2, nombre: "B" }] } }))

console.log("\n== helpers directos ==")
console.log("infoNuevaDe(info nueva):", JSON.stringify(infoNuevaDe({ info: j.info })).slice(0, 90))
console.log("filasPlanasDe(info nueva):", filasPlanasDe({ estadisticas: j.estadisticas }).length, "filas")
console.log("filasPlanasDe(stats viejas):", filasPlanasDe(JSON.parse(statsViejo)).length, "filas")

console.log("\n== errores ==")
console.log(JSON.stringify(combinar2Partes("no json", statsC)))
console.log(JSON.stringify(combinar3Partes(infoC, statsC, "{}")))
