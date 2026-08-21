import { useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { Desplegable } from "./Desplegable.jsx"
import { TablaAnalisis2 } from "./TablaAnalisis2.jsx"
import { TablaProbabilidadesOver } from "./TablaProbabilidadesOver.jsx"

export const Analisis2 = () => {
  const [probaTab, setProbaTab] = useState("resultados")
  const [ligas, setLigas] = useState([])
  const [jornada, setJornada] = useState("")
  const [corners, setCorners] = useState("")
  const [difGoles, setDifGoles] = useState("")
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
    setDifGoles("")
    setResultados(null)
    setCornersProb(null)
    setGolesProb(null)
    setError(null)
  }

  const enviar = async () => {
    setCargando(true)
    setError(null)
    try {
      const params = {
        ligas,
        jornada: Number(jornada) || 0,
      }
      if (corners !== "") params.corners = corners
      if (difGoles !== "") params.diferenciaGoles = difGoles
      const [resResultados, resCorners, resGoles] = await Promise.all([
        axios.get(`${API_URL}/api/probabilidades/analisis2`, { params }),
        axios.get(`${API_URL}/api/probabilidades/analisis2/corners`, { params }),
        axios.get(`${API_URL}/api/probabilidades/analisis2/goles`, { params }),
      ])
      setResultados(resResultados.data)
      setCornersProb(resCorners.data)
      setGolesProb(resGoles.data)
    } catch (err) {
      console.error("Error al consultar el análisis 2:", err)
      setError(err)
    } finally {
      setCargando(false)
    }
  }

  return (
    <section className="analisis2">
      <h2 className="view-title">Corners y diferencia</h2>

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
          <span className="result-value">{jornada < 1 ? "Todas" : jornada}</span>
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
          <span className="field-label">Diferencia de goles 1T</span>
          <input
            className="field-input"
            type="number"
            min="0"
            value={difGoles}
            onChange={(e) => setDifGoles(e.target.value)}
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
              : "Resultados Análisis 2"}
        </div>
        {error && <p className="tabla-status tabla-status-error">Error al consultar el análisis 2.</p>}
        {!error &&
          !cargando &&
          ((probaTab === "resultados" && resultados && resultados.length === 0) ||
            (probaTab === "corners" && cornersProb && cornersProb.length === 0) ||
            (probaTab === "goles" && golesProb && golesProb.length === 0)) && (
            <p className="tabla-status">Sin resultados con los filtros seleccionados.</p>
          )}
        {probaTab === "resultados" ? (
          <TablaAnalisis2 resultados={resultados} />
        ) : probaTab === "corners" ? (
          <TablaProbabilidadesOver resultados={cornersProb} etiqueta="Corners" />
        ) : (
          <TablaProbabilidadesOver resultados={golesProb} etiqueta="Goles" />
        )}
      </section>
    </section>
  )
}