import { useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { Desplegable } from "./Desplegable.jsx"
import { TablaRoja1t } from "./TablaRoja1t.jsx"
import { TablaProbabilidadesOver } from "./TablaProbabilidadesOver.jsx"

export const Roja1t = () => {
  const [probaTab, setProbaTab] = useState("resultados")
  const [ligas, setLigas] = useState([])
  const [jornada, setJornada] = useState("")
  const [corners, setCorners] = useState("")
  const [goles, setGoles] = useState("")
  const [resultados, setResultados] = useState(null)
  const [cornersProb, setCornersProb] = useState(null)
  const [rematesProb, setRematesProb] = useState(null)
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
    setRematesProb(null)
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
      const [resResultados, resCorners, resRemates, resGoles] = await Promise.all([
        axios.get(`${API_URL}/api/probabilidades/roja1t`, { params }),
        axios.get(`${API_URL}/api/probabilidades/roja1t/corners`, { params }),
        axios.get(`${API_URL}/api/probabilidades/roja1t/remates`, { params }),
        axios.get(`${API_URL}/api/probabilidades/roja1t/goles`, { params }),
      ])
      setResultados(resResultados.data)
      setCornersProb(resCorners.data)
      setRematesProb(resRemates.data)
      setGolesProb(resGoles.data)
    } catch (err) {
      console.error("Error al consultar roja 1T:", err)
      setError(err)
    } finally {
      setCargando(false)
    }
  }

  return (
    <section className="roja1t">
      <h2 className="view-title">Roja 1T</h2>

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

      <p className="tabla-status">Solo partidos con al menos 1 tarjeta roja en el primer tiempo.</p>

      <div className="tabs">
        {[
          { key: "resultados", etiqueta: "Resultados" },
          { key: "corners", etiqueta: "Corners" },
          { key: "remates", etiqueta: "Remates" },
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
            : probaTab === "remates"
              ? "Probabilidad de remates"
              : probaTab === "goles"
                ? "Probabilidad de goles"
                : "Resultados"}
        </div>
        {error && <p className="tabla-status tabla-status-error">Error al consultar roja 1T.</p>}
        {!error &&
          !cargando &&
          ((probaTab === "resultados" && resultados && resultados.length === 0) ||
            (probaTab === "corners" && cornersProb && cornersProb.length === 0) ||
            (probaTab === "remates" && rematesProb && rematesProb.length === 0) ||
            (probaTab === "goles" && golesProb && golesProb.length === 0)) && (
            <p className="tabla-status">Sin resultados con los filtros seleccionados.</p>
          )}
        {probaTab === "resultados" ? (
          <TablaRoja1t resultados={resultados} />
        ) : probaTab === "corners" ? (
          <TablaProbabilidadesOver resultados={cornersProb} etiqueta="Corners" />
        ) : probaTab === "remates" ? (
          <TablaProbabilidadesOver resultados={rematesProb} etiqueta="Remates" />
        ) : (
          <TablaProbabilidadesOver resultados={golesProb} etiqueta="Goles" />
        )}
      </section>
    </section>
  )
}