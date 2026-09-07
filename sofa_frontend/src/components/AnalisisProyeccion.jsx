import { useState, useMemo } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { Desplegable } from "./Desplegable.jsx"
import { BuscadorEquipo } from "./BuscadorEquipo.jsx"

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
const ratio = (x, y) => (y === 0 ? x : x / y)

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
    setLigas([]); setJornada(""); setEquipoLocal(""); setEquipoVisita("")
    setGolesLocal1T(""); setGolesVisita1T(""); setRemLocal1T(""); setRemVisita1T(""); setCornLocal1T(""); setCornVisita1T("")
    setDatosLocal(null); setDatosVisita(null); setError(null)
  }

  const fetchEquipo = async (equipo, goles1T) => {
    const params = { ligas, jornada: Number(jornada) || 0, equipo, golesEquipo1T: goles1T }
    const { data } = await axios.get(`${API_URL}/api/probabilidades/equipo/analisis-1t`, { params })
    return data
  }

  const enviar = async () => {
    if (!equipoLocal || !equipoVisita) { setError({ message: "Selecciona ambos equipos" }); return }
    setCargando(true); setError(null)
    try {
      const [resLocal, resVisita] = await Promise.all([
        fetchEquipo(equipoLocal, golesLocal1T),
        fetchEquipo(equipoVisita, golesVisita1T),
      ])
      // Filtrar por rival con mismos goles 1T que el rival real
      const gLocal = Number(golesLocal1T)
      const gVisita = Number(golesVisita1T)
      const filtradoLocal = resLocal.filter((r) => Number(r.goles_y_1t) === gVisita)
      const filtradoVisita = resVisita.filter((r) => Number(r.goles_y_1t) === gLocal)
      setDatosLocal({ todos: resLocal, filtrados: filtradoLocal })
      setDatosVisita({ todos: resVisita, filtrados: filtradoVisita })

      // Auto-selección remates/corners por similitud
      const rL = Number(remLocal1T), rV = Number(remVisita1T)
      const cL = Number(cornLocal1T), cV = Number(cornVisita1T)
      if (!Number.isNaN(rL) && !Number.isNaN(rV)) {
        setSelRemLocal(similitudRemates(rL, rV, filtradoLocal).map((x) => x.id))
        setSelRemVisita(similitudRemates(rV, rL, filtradoVisita).map((x) => x.id))
      }
      if (!Number.isNaN(cL) && !Number.isNaN(cV)) {
        setSelCornLocal(similitudCorners(rL !== rL ? 0 : rL, rV, filtradoLocal).map((x) => x.id)) // placeholder, correct below
        // corners usa corn
        setSelCornLocal(similitudCorners(cL, cV, filtradoLocal).map((x) => x.id))
        setSelCornVisita(similitudCorners(cV, cL, filtradoVisita).map((x) => x.id))
      }
    } catch (err) {
      console.error(err); setError(err)
    } finally { setCargando(false) }
  }

  const toggle = (set, id) => set((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const promedios = useMemo(() => {
    if (!datosLocal || !datosVisita) return null
    const golesLocal2T = datosLocal.filtrados.map((r) => Number(r.goles_x_2t))
    const golesVisita2T = datosVisita.filtrados.map((r) => Number(r.goles_x_2t))
    // para promedios de goles del rival en cada objeto (para completar tabla)
    const golesRivalLocal2T = datosLocal.filtrados.map((r) => Number(r.goles_y_2t))
    const golesRivalVisita2T = datosVisita.filtrados.map((r) => Number(r.goles_y_2t))

    const remLocalSel = datosLocal.filtrados.filter((r) => selRemLocal.includes(r.id))
    const remVisitaSel = datosVisita.filtrados.filter((r) => selRemVisita.includes(r.id))
    const cornLocalSel = datosLocal.filtrados.filter((r) => selCornLocal.includes(r.id))
    const cornVisitaSel = datosVisita.filtrados.filter((r) => selCornVisita.includes(r.id))

    const remLocal2T = remLocalSel.map((r) => Number(r.remates_x_2t))
    const remVisita2T = remVisitaSel.map((r) => Number(r.remates_x_2t))
    const cornLocal2T = cornLocalSel.map((r) => Number(r.corners_x_2t))
    const cornVisita2T = cornVisitaSel.map((r) => Number(r.corners_x_2t))

    // Combinados como en Excel: todos los goles 2T juntos
    const todosGolesLocal = [...golesLocal2T, ...golesRivalVisita2T]
    const todosGolesVisita = [...golesVisita2T, ...golesRivalLocal2T]
    const todosRemLocal = remLocal2T
    const todosRemVisita = remVisita2T
    const todosCornLocal = cornLocal2T
    const todosCornVisita = cornVisita2T

    return {
      golesLocal: { vals: todosGolesLocal, avg: avg(todosGolesLocal) },
      golesVisita: { vals: todosGolesVisita, avg: avg(todosGolesVisita) },
      remLocal: { vals: todosRemLocal, avg: avg(todosRemLocal), sel: remLocalSel },
      remVisita: { vals: todosRemVisita, avg: avg(todosRemVisita), sel: remVisitaSel },
      cornLocal: { vals: todosCornLocal, avg: avg(todosCornLocal), sel: cornLocalSel },
      cornVisita: { vals: todosCornVisita, avg: avg(todosCornVisita), sel: cornVisitaSel },
      golesLocalSolo: golesLocal2T,
      golesVisitaSolo: golesVisita2T,
    }
  }, [datosLocal, datosVisita, selRemLocal, selRemVisita, selCornLocal, selCornVisita])

  return (
    <section className="analisis-proyeccion">
      <h2 className="view-title">Proyección 2T — {equipoLocal || "Local"} vs {equipoVisita || "Visita"}</h2>

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
            <BuscadorEquipo onSelect={setEquipoVisita} />
            <p className="tabla-status">{equipoVisita || "—"}</p>
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
        <button className="btn btn-primary" onClick={enviar} disabled={cargando || !equipoLocal || !equipoVisita}>{cargando ? "Consultando..." : "Analizar"}</button>
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
            <tr><td>{equipoLocal}</td><td>{promedios.golesLocal.vals.join(",")}</td><td>{promedios.golesLocal.avg.toFixed(2)}</td><td>{promedios.remLocal.vals.join(",")}</td><td>{promedios.remLocal.avg.toFixed(2)}</td><td>{promedios.cornLocal.vals.join(",")}</td><td>{promedios.cornLocal.avg.toFixed(2)}</td><td>{golesLocal1T}-{golesVisita1T} / {remLocal1T}-{remVisita1T} / {cornLocal1T}-{cornVisita1T}</td><td>{(Number(golesLocal1T) + promedios.golesLocal.avg).toFixed(2)} - {(Number(golesVisita1T) + promedios.golesVisita.avg).toFixed(2)} / {(Number(remLocal1T) + promedios.remLocal.avg).toFixed(1)}-{(Number(remVisita1T) + promedios.remVisita.avg).toFixed(1)} / {(Number(cornLocal1T) + promedios.cornLocal.avg).toFixed(1)}-{(Number(cornVisita1T) + promedios.cornVisita.avg).toFixed(1)}</td></tr>
            <tr><td>{equipoVisita}</td><td>{promedios.golesVisita.vals.join(",")}</td><td>{promedios.golesVisita.avg.toFixed(2)}</td><td>{promedios.remVisita.vals.join(",")}</td><td>{promedios.remVisita.avg.toFixed(2)}</td><td>{promedios.cornVisita.vals.join(",")}</td><td>{promedios.cornVisita.avg.toFixed(2)}</td><td></td><td></td></tr>
          </tbody></table></div>
          <p className="tabla-status">Goles 2T: {equipoLocal} ({promedios.golesLocal.vals.length}) avg {promedios.golesLocal.avg.toFixed(3)} vs {equipoVisita} {promedios.golesVisita.avg.toFixed(3)} | Rem 2T {promedios.remLocal.avg.toFixed(2)} vs {promedios.remVisita.avg.toFixed(2)} | Corn {promedios.cornLocal.avg.toFixed(2)} vs {promedios.cornVisita.avg.toFixed(2)}</p>
          <p className="tabla-status">Ejemplo Betis 0-0 Madrid con datos del ejemplo: Goles 2T Madrid ~1.28 vs Betis 0.57 | Rem 4.66 vs 9.66 | Corn 1 vs 4.66 — suma con 1T para FT.</p>
        </section>
      )}
    </section>
  )
}
