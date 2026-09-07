import { useState } from 'react'
import axios from 'axios'
import './App.css'
import { API_URL } from './config.js'
import { MenuAcordeon } from './components/MenuAcordeon.jsx'
import { Desplegable } from './components/Desplegable.jsx'
import { UltimosPartidos } from './components/UltimosPartidos.jsx'
import { Analisis2 } from './components/Analisis2.jsx'
import { Analisis3 } from './components/Analisis3.jsx'
import { RematesGoles } from './components/RematesGoles.jsx'
import { Roja1t } from './components/Roja1t.jsx'
import { GolesEquipo } from './components/GolesEquipo.jsx'
import { AnalisisEquipo1T } from './components/AnalisisEquipo1T.jsx'
import { AnalisisProyeccion } from './components/AnalisisProyeccion.jsx'
import { Equipos } from './components/Equipos.jsx'
import { TablaProbabilidades } from './components/TablaProbabilidades.jsx'
import { TablaProbabilidadesOver } from './components/TablaProbabilidadesOver.jsx'

function App() {
  const [vista, setVista] = useState("analisis1")
  const [probaTab, setProbaTab] = useState("resultados")
  const [ligas, setLigas] = useState([])
  const [jornada, setJornada] = useState("")
  const [corners, setCorners] = useState("")
  const [goles, setGoles] = useState("")
  const [resultados, setResultados] = useState(null)
  const [cornersProb, setCornersProb] = useState(null)
  const [golesProb, setGolesProb] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  const handleLigaChange = (e) => {
    const liga = e.target.value
    setLigas((prev) => (prev.includes(liga) ? prev : [...prev, liga]))
  }

  const limpiar = () => {
    setLigas([])
    setJornada("")
    setCorners("")
    setGoles("")
    setResultados(null)
    setCornersProb(null)
    setGolesProb(null)
    setError(null)
  }

  const enviar = async () => {
    setCargando(true)
    setError(null)
    const params = {
      ligas,
      jornada: Number(jornada) || 0,
    }
    if (corners !== "") params.corners = corners
    if (goles !== "") params.goles = goles
    try {
      const [resResultados, resCorners, resGoles] = await Promise.all([
        axios.get(`${API_URL}/api/probabilidades`, { params }),
        axios.get(`${API_URL}/api/probabilidades/corners`, { params }),
        axios.get(`${API_URL}/api/probabilidades/goles`, { params }),
      ])
      setResultados(resResultados.data)
      setCornersProb(resCorners.data)
      setGolesProb(resGoles.data)
    } catch (err) {
      console.error("Error al consultar probabilidades:", err)
      setError(err)
    } finally {
      setCargando(false)
    }
  }

  return (
    <main className="app">
      <h1 className="app-title">Sofa</h1>

      <MenuAcordeon vista={vista} onVista={setVista} />

      {vista === "ultimos" ? (
        <UltimosPartidos />
      ) : vista === "analisis2" ? (
        <Analisis2 />
      ) : vista === "analisis3" ? (
        <Analisis3 />
      ) : vista === "remates" ? (
        <RematesGoles />
      ) : vista === "roja1t" ? (
        <Roja1t />
      ) : vista === "golesEquipo" ? (
        <GolesEquipo />
      ) : vista === "analisisEquipo1T" ? (
        <AnalisisEquipo1T />
      ) : vista === "proyeccion" ? (
        <AnalisisProyeccion />
      ) : vista === "equipos" ? (
        <Equipos />
      ) : (
        <>
          <h2 className="view-title">Corners y goles</h2>

          <Desplegable onChange={handleLigaChange} />

          <section className="card">
            <div className="card-header">Selección</div>
            <div className="result-row">
              <span className="result-label">Liga 1</span>
              <span className="result-value">{ligas[0] || "—"}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Liga 2</span>
              <span className="result-value">{ligas[1] || "—"}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Jornada</span>
              <span className="result-value">{jornada < 1 ? 'Todas' : jornada}</span>
            </div>
          </section>

          <section className="card">
            <div className="card-header">Filtros de mercado</div>
            <label className="field">
              <span className="field-label">Jornada</span>
              <input
                className="field-input"
                type="number"
                min="0"
                value={jornada}
                onChange={(e) => setJornada(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Cantidad de corners 1T</span>
              <input
                className="field-input"
                type="number"
                min="0"
                value={corners}
                onChange={(e) => setCorners(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Cantidad de goles 1T</span>
              <input
                className="field-input"
                type="number"
                min="0"
                value={goles}
                onChange={(e) => setGoles(e.target.value)}
              />
            </label>
          </section>

          <div className="actions">
            <button className="btn btn-secondary" onClick={limpiar}>Limpiar</button>
            <button className="btn btn-primary" onClick={enviar} disabled={cargando}>
              {cargando ? "Consultando..." : "Fetch"}
            </button>
          </div>

          <div className="tabs">
            {[
              { key: "resultados", etiqueta: "Resultados" },
              { key: "corners", etiqueta: "Corners" },
              { key: "goles", etiqueta: "Goles" },
            ].map(({ key, etiqueta }) => (
              <button
                key={key}
                className={`tab ${probaTab === key ? "tab-active" : ""}`}
                onClick={() => setProbaTab(key)}
              >
                {etiqueta}
              </button>
            ))}
          </div>

          <section className="card">
            <div className="card-header">
              {probaTab === "corners"
                ? "Probabilidad de corners"
                : probaTab === "goles"
                  ? "Probabilidad de goles"
                  : "Resultados"}
            </div>
            {error && <p className="tabla-status tabla-status-error">Error al consultar probabilidades.</p>}
            {!error &&
              !cargando &&
              ((probaTab === "resultados" && resultados && resultados.length === 0) ||
                (probaTab === "corners" && cornersProb && cornersProb.length === 0) ||
                (probaTab === "goles" && golesProb && golesProb.length === 0)) && (
                <p className="tabla-status">Sin resultados con los filtros seleccionados.</p>
              )}
            {probaTab === "resultados" ? (
              <TablaProbabilidades resultados={resultados} />
            ) : probaTab === "corners" ? (
              <TablaProbabilidadesOver resultados={cornersProb} etiqueta="Corners" />
            ) : (
              <TablaProbabilidadesOver resultados={golesProb} etiqueta="Goles" />
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default App