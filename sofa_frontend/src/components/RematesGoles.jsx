import { useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { Desplegable } from "./Desplegable.jsx"
import { TablaProbabilidades } from "./TablaProbabilidades.jsx"
import { TablaProbabilidadesOver } from "./TablaProbabilidadesOver.jsx"

export const RematesGoles = () => {
  const [probaTab, setProbaTab] = useState("resultados")
  const [ligas, setLigas] = useState([])
  const [jornada, setJornada] = useState("")
  const [remates, setRemates] = useState("")
  const [goles, setGoles] = useState("")
  const [resultados, setResultados] = useState(null)
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
    setRemates("")
    setGoles("")
    setResultados(null)
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
    if (remates !== "") params.corners = remates
    if (goles !== "") params.goles = goles
    try {
      const [resResultados, resRemates, resGoles] = await Promise.all([
        axios.get(`${API_URL}/api/probabilidades/remates`, { params }),
        axios.get(`${API_URL}/api/probabilidades/remates/over`, { params }),
        axios.get(`${API_URL}/api/probabilidades/goles`, { params }),
      ])
      setResultados(resResultados.data)
      setRematesProb(resRemates.data)
      setGolesProb(resGoles.data)
    } catch (err) {
      console.error("Error al consultar probabilidades de remates:", err)
      setError(err)
    } finally {
      setCargando(false)
    }
  }

  return (
    <section className="remates-goles">
      <h2 className="view-title">Remates y goles</h2>

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
          <span className="field-label">Cantidad de remates 1T</span>
          <input
            className="field-input"
            type="number"
            min="0"
            value={remates}
            onChange={(e) => setRemates(e.target.value)}
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
          {probaTab === "remates"
            ? "Probabilidad de remates"
            : probaTab === "goles"
              ? "Probabilidad de goles"
              : "Resultados"}
        </div>
        {error && <p className="tabla-status tabla-status-error">Error al consultar probabilidades de remates.</p>}
        {!error &&
          !cargando &&
          ((probaTab === "resultados" && resultados && resultados.length === 0) ||
            (probaTab === "remates" && rematesProb && rematesProb.length === 0) ||
            (probaTab === "goles" && golesProb && golesProb.length === 0)) && (
            <p className="tabla-status">Sin resultados con los filtros seleccionados.</p>
          )}
        {probaTab === "resultados" ? (
          <TablaProbabilidades resultados={resultados} etiqueta="Remates" prefijo="remates" />
        ) : probaTab === "remates" ? (
          <TablaProbabilidadesOver resultados={rematesProb} etiqueta="Remates" />
        ) : (
          <TablaProbabilidadesOver resultados={golesProb} etiqueta="Goles" />
        )}
      </section>
    </section>
  )
}