import { useState, useMemo } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { Desplegable } from "./Desplegable.jsx"
import { BuscadorEquipo } from "./BuscadorEquipo.jsx"

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
const ratio = (x, y) => (y === 0 ? x : x / y)

// Formatea sin decimales innecesarios: 1.00 -> "1", 1.50 -> "1.5", 1.28 -> "1.28"
const fmt = (n, dec = 2) => {
  if (n === "" || n === null || n === undefined) return "—"
  const num = Number(n)
  if (Number.isNaN(num)) return "—"
  return num
    .toFixed(dec)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "")
}

const similitudRemates = (targetX, targetY, candidatos) => {
  if (!candidatos.length) return []
  const tRatio = ratio(targetX, targetY)
  // 1) ratio exacto (epsilon 0.01)
  const exactos = candidatos.filter((c) => Math.abs(ratio(c.remates_x_1t, c.remates_y_1t) - tRatio) < 0.01)
  if (exactos.length) return exactos
  // 2) Manhattan con margen +-2 (distancia mínima +2)
  const conDist = candidatos.map((c) => ({
    ...c,
    _dist: Math.abs(c.remates_x_1t - targetX) + Math.abs(c.remates_y_1t - targetY),
  }))
  const min = Math.min(...conDist.map((c) => c._dist))
  return conDist.filter((c) => c._dist <= min + 2)
}

const similitudCorners = (targetX, targetY, candidatos) => {
  if (!candidatos.length) return []
  const tRatio = ratio(targetX, targetY)
  const exactos = candidatos.filter((c) => Math.abs(ratio(c.corners_x_1t, c.corners_y_1t) - tRatio) < 0.01)
  if (exactos.length) return exactos
  const conDist = candidatos.map((c) => ({
    ...c,
    _dist: Math.abs(c.corners_x_1t - targetX) + Math.abs(c.corners_y_1t - targetY),
    _sum: c.corners_x_1t + c.corners_y_1t,
  }))
  const tSum = targetX + targetY
  // fallback por suma total más cercana si ratio no hay
  const minSumDist = Math.min(...conDist.map((c) => Math.abs(c._sum - tSum)))
  const porSuma = conDist.filter((c) => Math.abs(c._sum - tSum) === minSumDist)
  if (porSuma.length) return porSuma
  const min = Math.min(...conDist.map((c) => c._dist))
  return conDist.filter((c) => c._dist <= min + 2)
}

export const AnalisisProyeccion = () => {
  const [ligas, setLigas] = useState([])
  const [jornada, setJornada] = useState("")
  const [equipoLocal, setEquipoLocal] = useState("")
  const [equipoVisita, setEquipoVisita] = useState("")
  const [rivalDesconocido, setRivalDesconocido] = useState(false)
  const [golesLocal1T, setGolesLocal1T] = useState("")
  const [golesVisita1T, setGolesVisita1T] = useState("")
  const [remLocal1T, setRemLocal1T] = useState("")
  const [remVisita1T, setRemVisita1T] = useState("")
  const [cornLocal1T, setCornLocal1T] = useState("")
  const [cornVisita1T, setCornVisita1T] = useState("")
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [datosLocal, setDatosLocal] = useState(null)
  const [datosVisita, setDatosVisita] = useState(null)
  const [selRemLocal, setSelRemLocal] = useState([])
  const [selCornLocal, setSelCornLocal] = useState([])
  const [selRemVisita, setSelRemVisita] = useState([])
  const [selCornVisita, setSelCornVisita] = useState([])

  const handleLigaChange = (e) => {
    const liga = e.target.value
    setLigas((prev) => (prev.includes(liga) ? prev : [...prev, liga]))
  }

  const limpiar = () => {
    setLigas([]); setJornada(""); setEquipoLocal(""); setEquipoVisita(""); setRivalDesconocido(false)
    setGolesLocal1T(""); setGolesVisita1T(""); setRemLocal1T(""); setRemVisita1T(""); setCornLocal1T(""); setCornVisita1T("")
    setDatosLocal(null); setDatosVisita(null); setError(null)
  }

  const fetchEquipo = async (equipo, goles1T) => {
    const params = { ligas, jornada: Number(jornada) || 0, equipo, golesEquipo1T: goles1T }
    const { data } = await axios.get(`${API_URL}/api/probabilidades/equipo/analisis-1t`, { params })
    return data
  }

  const enviar = async () => {
    if (!equipoLocal) { setError({ message: "Selecciona el equipo local" }); return }
    if (!rivalDesconocido && !equipoVisita) { setError({ message: "Selecciona el equipo visita o marca rival desconocido" }); return }
    setCargando(true); setError(null)
    try {
      // Filtrar por rival con mismos goles 1T que el rival real
      const gLocal = Number(golesLocal1T)
      const gVisita = Number(golesVisita1T)
      const rL = Number(remLocal1T), rV = Number(remVisita1T)
      const cL = Number(cornLocal1T), cV = Number(cornVisita1T)

      const resLocal = await fetchEquipo(equipoLocal, golesLocal1T)
      const filtradoLocal = resLocal.filter((r) => Number(r.goles_y_1t) === gVisita)
      setDatosLocal({ todos: resLocal, filtrados: filtradoLocal })

      // Auto-selección remates/corners por similitud (lado local)
      if (!Number.isNaN(rL) && !Number.isNaN(rV)) {
        setSelRemLocal(similitudRemates(rL, rV, filtradoLocal).map((x) => x.id))
      }
      if (!Number.isNaN(cL) && !Number.isNaN(cV)) {
        setSelCornLocal(similitudCorners(cL, cV, filtradoLocal).map((x) => x.id))
      }

      if (rivalDesconocido) {
        // Sin historial del rival: sus promedios 2T se estiman con el lado Y
        // (lo que hicieron los rivales) de los partidos filtrados del local.
        setDatosVisita(null)
        setSelRemVisita([])
        setSelCornVisita([])
      } else {
        const resVisita = await fetchEquipo(equipoVisita, golesVisita1T)
        const filtradoVisita = resVisita.filter((r) => Number(r.goles_y_1t) === gLocal)
        setDatosVisita({ todos: resVisita, filtrados: filtradoVisita })
        if (!Number.isNaN(rL) && !Number.isNaN(rV)) {
          setSelRemVisita(similitudRemates(rV, rL, filtradoVisita).map((x) => x.id))
        }
        if (!Number.isNaN(cL) && !Number.isNaN(cV)) {
          setSelCornVisita(similitudCorners(cV, cL, filtradoVisita).map((x) => x.id))
        }
      }
    } catch (err) {
      console.error(err); setError(err)
    } finally { setCargando(false) }
  }

  const toggle = (set, id) => set((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const promedios = useMemo(() => {
    if (!datosLocal) return null
    const desconocido = !datosVisita
    const golesLocal2T = datosLocal.filtrados.map((r) => Number(r.goles_x_2t))
    // lo que hicieron los rivales (lado Y) en los partidos filtrados del local
    const golesRivalLocal2T = datosLocal.filtrados.map((r) => Number(r.goles_y_2t))

    const remLocalSel = datosLocal.filtrados.filter((r) => selRemLocal.includes(r.id))
    const cornLocalSel = datosLocal.filtrados.filter((r) => selCornLocal.includes(r.id))

    const remLocal2T = remLocalSel.map((r) => Number(r.remates_x_2t))
    const cornLocal2T = cornLocalSel.map((r) => Number(r.corners_x_2t))

    let todosGolesLocal, todosGolesVisita, todosRemLocal, todosRemVisita, todosCornLocal, todosCornVisita
    let remVisitaSel = [], cornVisitaSel = [], golesVisitaSolo = []
    if (desconocido) {
      // Rival desconocido: sus promedios salen del lado Y del historial del local
      todosGolesLocal = golesLocal2T
      todosGolesVisita = golesRivalLocal2T
      todosRemLocal = remLocal2T
      todosRemVisita = remLocalSel.map((r) => Number(r.remates_y_2t))
      todosCornLocal = cornLocal2T
      todosCornVisita = cornLocalSel.map((r) => Number(r.corners_y_2t))
    } else {
      const golesVisita2T = datosVisita.filtrados.map((r) => Number(r.goles_x_2t))
      const golesRivalVisita2T = datosVisita.filtrados.map((r) => Number(r.goles_y_2t))
      remVisitaSel = datosVisita.filtrados.filter((r) => selRemVisita.includes(r.id))
      cornVisitaSel = datosVisita.filtrados.filter((r) => selCornVisita.includes(r.id))
      // Combinados como en Excel: todos los goles 2T juntos
      todosGolesLocal = [...golesLocal2T, ...golesRivalVisita2T]
      todosGolesVisita = [...golesVisita2T, ...golesRivalLocal2T]
      todosRemLocal = remLocal2T
      todosRemVisita = remVisitaSel.map((r) => Number(r.remates_x_2t))
      todosCornLocal = cornLocal2T
      todosCornVisita = cornVisitaSel.map((r) => Number(r.corners_x_2t))
      golesVisitaSolo = golesVisita2T
    }

    return {
      desconocido,
      golesLocal: { vals: todosGolesLocal, avg: avg(todosGolesLocal) },
      golesVisita: { vals: todosGolesVisita, avg: avg(todosGolesVisita) },
      remLocal: { vals: todosRemLocal, avg: avg(todosRemLocal), sel: remLocalSel },
      remVisita: { vals: todosRemVisita, avg: avg(todosRemVisita), sel: remVisitaSel },
      cornLocal: { vals: todosCornLocal, avg: avg(todosCornLocal), sel: cornLocalSel },
      cornVisita: { vals: todosCornVisita, avg: avg(todosCornVisita), sel: cornVisitaSel },
      golesLocalSolo: golesLocal2T,
      golesVisitaSolo,
    }
  }, [datosLocal, datosVisita, selRemLocal, selRemVisita, selCornLocal, selCornVisita])

  return (
    <section className="analisis-proyeccion">
      <h2 className="view-title">Proyección 2T — {equipoLocal || "Local"} vs {rivalDesconocido ? "Rival desconocido" : (equipoVisita || "Visita")}</h2>

      <Desplegable onChange={handleLigaChange} />
      <section className="card">
        <div className="card-header">Filtros partido a analizar</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="field"><span className="field-label">Equipo Local (X)</span></label>
            <BuscadorEquipo onSelect={setEquipoLocal} />
            <p className="tabla-status">{equipoLocal || "—"}</p>
          </div>
          <div>
            <label className="field"><span className="field-label">Equipo Visita (Y)</span></label>
            {rivalDesconocido ? (
              <>
                <p className="tabla-status">Rival desconocido: no está en la base, solo se usará el historial de {equipoLocal || "el local"}.</p>
                <button className="tab" style={{ marginTop: "8px" }} onClick={() => { setRivalDesconocido(false); setDatosVisita(null) }}>Elegir equipo...</button>
              </>
            ) : (
              <>
                <BuscadorEquipo onSelect={setEquipoVisita} />
                <p className="tabla-status">{equipoVisita || "—"}</p>
                <button className="tab" style={{ marginTop: "8px" }} onClick={() => { setRivalDesconocido(true); setEquipoVisita(""); setDatosVisita(null) }}>Rival desconocido</button>
              </>
            )}
          </div>
        </div>
        <label className="field"><span className="field-label">Ligas (selectable)</span><span className="tabla-status">{ligas.join(", ") || "Todas"}</span></label>
        <label className="field"><span className="field-label">Jornada (&gt; jornada)</span><input className="field-input" type="number" value={jornada} onChange={(e) => setJornada(e.target.value)} placeholder="0=todas" /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="field"><span className="field-label">Goles 1T Local</span><input className="field-input" type="number" value={golesLocal1T} onChange={(e) => setGolesLocal1T(e.target.value)} /></label>
          <label className="field"><span className="field-label">Goles 1T Visita</span><input className="field-input" type="number" value={golesVisita1T} onChange={(e) => setGolesVisita1T(e.target.value)} /></label>
          <label className="field"><span className="field-label">Remates 1T Local</span><input className="field-input" type="number" value={remLocal1T} onChange={(e) => setRemLocal1T(e.target.value)} /></label>
          <label className="field"><span className="field-label">Remates 1T Visita</span><input className="field-input" type="number" value={remVisita1T} onChange={(e) => setRemVisita1T(e.target.value)} /></label>
          <label className="field"><span className="field-label">Corners 1T Local</span><input className="field-input" type="number" value={cornLocal1T} onChange={(e) => setCornLocal1T(e.target.value)} /></label>
          <label className="field"><span className="field-label">Corners 1T Visita</span><input className="field-input" type="number" value={cornVisita1T} onChange={(e) => setCornVisita1T(e.target.value)} /></label>
        </div>
      </section>

      <div className="actions">
        <button className="btn btn-secondary" onClick={limpiar}>Limpiar</button>
        <button className="btn btn-primary" onClick={enviar} disabled={cargando || !equipoLocal || (!rivalDesconocido && !equipoVisita)}>{cargando ? "Consultando..." : "Analizar"}</button>
      </div>

      {error && <p className="tabla-status tabla-status-error">{error.response?.data?.message || error.message}</p>}

      {datosLocal && (
        <section className="card">
          <div className="card-header">{equipoLocal} — {datosLocal.filtrados.length} de {datosLocal.todos.length} partidos (rival {golesVisita1T} gol 1T)</div>
          <p className="tabla-status">Filtrados donde rival hizo {golesVisita1T} gol 1T (como {equipoVisita}). Goles 2T X: [{datosLocal.filtrados.map((r) => r.goles_x_2t).join(",")}] | Rival 2T: [{datosLocal.filtrados.map((r) => r.goles_y_2t).join(",")}]</p>
          <div className="tabla-scroll"><table className="tabla"><thead><tr><th>Rival</th><th>Cond.</th><th>G 1T X-Y</th><th>G 2T X-Y</th><th>Rem 1T X-Y</th><th>Rem 2T X-Y</th><th>Corn 1T X-Y</th><th>Corn 2T X-Y</th><th>Sel Rem</th><th>Sel Corn</th></tr></thead><tbody>
            {datosLocal.filtrados.map((r) => (
              <tr key={r.id}>
                <td>{r.equipo_y}</td><td>{r.condicion_x}</td>
                <td>{r.goles_x_1t}-{r.goles_y_1t}</td><td>{r.goles_x_2t}-{r.goles_y_2t}</td>
                <td>{r.remates_x_1t}-{r.remates_y_1t}</td><td>{r.remates_x_2t}-{r.remates_y_2t}</td>
                <td>{r.corners_x_1t}-{r.corners_y_1t}</td><td>{r.corners_x_2t}-{r.corners_y_2t}</td>
                <td><input type="checkbox" checked={selRemLocal.includes(r.id)} onChange={() => toggle(setSelRemLocal, r.id)} /></td>
                <td><input type="checkbox" checked={selCornLocal.includes(r.id)} onChange={() => toggle(setSelCornLocal, r.id)} /></td>
              </tr>
            ))}
          </tbody></table></div>
          <p className="tabla-status">Remates auto-selección por ratio exacto sino Manhattan ≤ min+2. Edita checks para ajustar promedio.</p>
        </section>
      )}

      {datosVisita && (
        <section className="card">
          <div className="card-header">{equipoVisita} — {datosVisita.filtrados.length} de {datosVisita.todos.length} partidos (rival {golesLocal1T} gol 1T)</div>
          <p className="tabla-status">Filtrados donde rival hizo {golesLocal1T} gol 1T (como {equipoLocal}). Goles 2T X: [{datosVisita.filtrados.map((r) => r.goles_x_2t).join(",")}]</p>
          <div className="tabla-scroll"><table className="tabla"><thead><tr><th>Rival</th><th>Cond.</th><th>G 1T</th><th>G 2T</th><th>Rem 1T</th><th>Rem 2T</th><th>Corn 1T</th><th>Corn 2T</th><th>Sel Rem</th><th>Sel Corn</th></tr></thead><tbody>
            {datosVisita.filtrados.map((r) => (
              <tr key={r.id}>
                <td>{r.equipo_y}</td><td>{r.condicion_x}</td>
                <td>{r.goles_x_1t}-{r.goles_y_1t}</td><td>{r.goles_x_2t}-{r.goles_y_2t}</td>
                <td>{r.remates_x_1t}-{r.remates_y_1t}</td><td>{r.remates_x_2t}-{r.remates_y_2t}</td>
                <td>{r.corners_x_1t}-{r.corners_y_1t}</td><td>{r.corners_x_2t}-{r.corners_y_2t}</td>
                <td><input type="checkbox" checked={selRemVisita.includes(r.id)} onChange={() => toggle(setSelRemVisita, r.id)} /></td>
                <td><input type="checkbox" checked={selCornVisita.includes(r.id)} onChange={() => toggle(setSelCornVisita, r.id)} /></td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
      )}

      {promedios && (
        <section className="card">
          <div className="card-header">Promedios 2T y Proyección FT</div>
          <div className="tabla-scroll"><table className="tabla"><thead><tr><th>Equipo</th><th>Goles 2T vals</th><th>Prom</th><th>Rem 2T vals</th><th>Prom</th><th>Corn 2T vals</th><th>Prom</th><th>1T real</th><th>FT estimado (1T+Prom)</th></tr></thead><tbody>
            <tr><td>{equipoLocal}</td><td>{promedios.golesLocal.vals.join(", ")}</td><td className="tabla-num">{fmt(promedios.golesLocal.avg)}</td><td>{promedios.remLocal.vals.join(", ")}</td><td className="tabla-num">{fmt(promedios.remLocal.avg)}</td><td>{promedios.cornLocal.vals.join(", ")}</td><td className="tabla-num">{fmt(promedios.cornLocal.avg)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <div><span className="result-label">Gol: </span>{golesLocal1T || "—"} - {golesVisita1T || "—"}</div>
                <div><span className="result-label">Rem: </span>{remLocal1T || "—"} - {remVisita1T || "—"}</div>
                <div><span className="result-label">Cór: </span>{cornLocal1T || "—"} - {cornVisita1T || "—"}</div>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <div><span className="result-label">Gol: </span>{fmt(Number(golesLocal1T || 0) + promedios.golesLocal.avg)} - {fmt(Number(golesVisita1T || 0) + promedios.golesVisita.avg)}</div>
                <div><span className="result-label">Rem: </span>{fmt(Number(remLocal1T || 0) + promedios.remLocal.avg, 1)} - {fmt(Number(remVisita1T || 0) + promedios.remVisita.avg, 1)}</div>
                <div><span className="result-label">Cór: </span>{fmt(Number(cornLocal1T || 0) + promedios.cornLocal.avg, 1)} - {fmt(Number(cornVisita1T || 0) + promedios.cornVisita.avg, 1)}</div>
              </td></tr>
            <tr><td>{promedios.desconocido ? "Rival desconocido (estimado)" : equipoVisita}</td><td>{promedios.golesVisita.vals.join(", ")}</td><td className="tabla-num">{fmt(promedios.golesVisita.avg)}</td><td>{promedios.remVisita.vals.join(", ")}</td><td className="tabla-num">{fmt(promedios.remVisita.avg)}</td><td>{promedios.cornVisita.vals.join(", ")}</td><td className="tabla-num">{fmt(promedios.cornVisita.avg)}</td><td></td><td></td></tr>
          </tbody></table></div>
          <p className="tabla-status">Goles 2T: {equipoLocal} ({promedios.golesLocal.vals.length}) avg {fmt(promedios.golesLocal.avg, 3)} vs {promedios.desconocido ? "Rival desconocido" : equipoVisita} {fmt(promedios.golesVisita.avg, 3)} | Rem 2T {fmt(promedios.remLocal.avg)} vs {fmt(promedios.remVisita.avg)} | Corn {fmt(promedios.cornLocal.avg)} vs {fmt(promedios.cornVisita.avg)}</p>
          {promedios.desconocido && (
            <p className="tabla-status">Rival desconocido: sus promedios 2T se estiman con lo que hicieron los rivales en los partidos filtrados de {equipoLocal} (lado Y).</p>
          )}
          <p className="tabla-status">Ejemplo Betis 0-0 Madrid con datos del ejemplo: Goles 2T Madrid ~1.28 vs Betis 0.57 | Rem 4.66 vs 9.66 | Corn 1 vs 4.66 — suma con 1T para FT.</p>
        </section>
      )}
    </section>
  )
}
