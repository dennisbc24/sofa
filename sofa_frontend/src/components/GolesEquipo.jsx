import { useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { Desplegable } from "./Desplegable.jsx"
import { BuscadorEquipo } from "./BuscadorEquipo.jsx"
import { TablaAnalisis3 } from "./TablaAnalisis3.jsx"
import { TablaProbabilidadesOver } from "./TablaProbabilidadesOver.jsx"

export const GolesEquipo = () => {
  const [probaTab, setProbaTab] = useState("resultados")
  const [ligas, setLigas] = useState([])
  const [jornada, setJornada] = useState("")
  const [equipo, setEquipo] = useState("")
  const [goles1T, setGoles1T] = useState("")
  const [resultados, setResultados] = useState(null)
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
    setEquipo("")
    setGoles1T("")
    setResultados(null)
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
    if (equipo !== "") params.equipo = equipo
    if (goles1T !== "") params.goles1T = goles1T
    try {
      const [resResultados, resGoles] = await Promise.all([
        axios.get(`${API_URL}/api/probabilidades/equipo/goles`, { params }),
        axios.get(`${API_URL}/api/probabilidades/equipo/goles/distribucion`, { params }),
      ])
      setResultados(resResultados.data)
      setGolesProb(resGoles.data)
    } catch (err) {
      console.error("Error al consultar goles por equipo:", err)
      setError(err)
    } finally {
      setCargando(false)
    }
  }

  return (
    <section className="goles-equipo">
      <h2 className="view-title">Goles por equipo</h2>

      <Desplegable onChange={handleLigaChange} />

      <section className="card">
        <div className="card-header">Selección</div>
        <div className="result-row">
          <span className="result-label">Equipo</span>
          <span className="result-value">{equipo || "—"}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Goles totales 1T</span>
          <span className="result-value">{goles1T === "" ? "Cualquiera" : goles1T}</span>
        </div>
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
          <span className="result-value">{jornada < 1 ? "Todas" : jornada}</span>
        </div>
      </section>

      <section className="card">
        <div className="card-header">Filtros</div>
        <BuscadorEquipo onSelect={setEquipo} />
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
          <span className="field-label">Goles totales 1T (local + visitante)</span>
          <input
            className="field-input"
            type="number"
            min="0"
            value={goles1T}
            onChange={(e) => setGoles1T(e.target.value)}
          />
        </label>
      </section>

      <div className="actions">
        <button className="btn btn-secondary" onClick={limpiar}>Limpiar</button>
        <button className="btn btn-primary" onClick={enviar} disabled={cargando}>
          {cargando ? "Consultando..." : "Fetch"}
        </button>
      </div>

      <p className="tabla-status">
        Partidos del equipo donde la suma de goles (local + visitante) en el 1T coincide con el filtro.
      </p>

      <div className="tabs">
        {[
          { key: "resultados", etiqueta: "Resultados" },
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
          {probaTab === "goles" ? "Probabilidad de goles" : "Resultados"}
        </div>
        {error && <p className="tabla-status tabla-status-error">Error al consultar goles por equipo.</p>}
        {!error &&
          !cargando &&
          ((probaTab === "resultados" && resultados && resultados.length === 0) ||
            (probaTab === "goles" && golesProb && golesProb.length === 0)) && (
            <p className="tabla-status">Sin resultados con los filtros seleccionados.</p>
          )}
        {probaTab === "resultados" ? (
          <TablaAnalisis3 resultados={resultados} equipo={equipo} />
        ) : (
          <TablaProbabilidadesOver resultados={golesProb} etiqueta="Goles" />
        )}
      </section>
    </section>
  )
}
