import { useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { Desplegable } from "./Desplegable.jsx"
import { BuscadorEquipo } from "./BuscadorEquipo.jsx"
import { TablaAnalisisEquipo1T, TablaAnalisisEquipo1TExpandida } from "./TablaAnalisisEquipo1T.jsx"

export const AnalisisEquipo1T = () => {
  const [ligas, setLigas] = useState([])
  const [jornada, setJornada] = useState("")
  const [equipo, setEquipo] = useState("")
  const [golesEquipo1T, setGolesEquipo1T] = useState("")
  const [expandida, setExpandida] = useState(false)
  const [resultados, setResultados] = useState(null)
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
    setGolesEquipo1T("")
    setResultados(null)
    setError(null)
  }

  const enviar = async () => {
    if (!equipo) {
      setError({ message: "Selecciona un equipo" })
      return
    }
    setCargando(true)
    setError(null)
    const params = {
      ligas,
      jornada: Number(jornada) || 0,
      equipo,
    }
    if (golesEquipo1T !== "") params.golesEquipo1T = golesEquipo1T
    // compat: backend acepta golesEquipo o golesEquipo1T
    try {
      const res = await axios.get(`${API_URL}/api/probabilidades/equipo/analisis-1t`, { params })
      setResultados(res.data)
    } catch (err) {
      console.error("Error analisis equipo 1T:", err)
      setError(err)
    } finally {
      setCargando(false)
    }
  }

  return (
    <section className="analisis-equipo1t">
      <h2 className="view-title">Equipo × Goles 1T (detalle)</h2>

      <Desplegable onChange={handleLigaChange} />

      <section className="card">
        <div className="card-header">Selección</div>
        <div className="result-row">
          <span className="result-label">Equipo</span>
          <span className="result-value">{equipo || "—"}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Goles equipo 1T</span>
          <span className="result-value">{golesEquipo1T === "" ? "Cualquiera" : golesEquipo1T}</span>
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
        {equipo && <p className="tabla-status">Equipo seleccionado: <strong>{equipo}</strong></p>}
        <label className="field">
          <span className="field-label">Jornada ( &gt; jornada )</span>
          <input
            className="field-input"
            type="number"
            min="0"
            value={jornada}
            onChange={(e) => setJornada(e.target.value)}
            placeholder="0 = todas"
          />
        </label>
        <label className="field">
          <span className="field-label">Goles de {equipo || "equipo"} en 1T</span>
          <input
            className="field-input"
            type="number"
            min="0"
            value={golesEquipo1T}
            onChange={(e) => setGolesEquipo1T(e.target.value)}
            placeholder="Ej: 0, 1, 2"
          />
        </label>
        <p className="tabla-status">Filtra partidos donde <strong>{equipo || "el equipo"}</strong> marcó exactamente {golesEquipo1T === "" ? "N" : golesEquipo1T} gol(es) en el primer tiempo (local o visitante).</p>
      </section>

      <div className="actions">
        <button className="btn btn-secondary" onClick={limpiar}>Limpiar</button>
        <button className="btn btn-primary" onClick={enviar} disabled={cargando || !equipo}>
          {cargando ? "Consultando..." : "Fetch"}
        </button>
        {resultados?.length > 0 && (
          <button className="btn btn-secondary" onClick={() => setExpandida((v) => !v)}>
            {expandida ? "Vista compacta" : "Vista expandida"}
          </button>
        )}
      </div>

      <section className="card">
        <div className="card-header">Resultados {resultados ? `(${resultados.length})` : ""}</div>
        {error && <p className="tabla-status tabla-status-error">{error.response?.data?.message || error.message || "Error al consultar."} { !equipo && "Selecciona un equipo."}</p>}
        {!error && !cargando && resultados && resultados.length === 0 && (
          <p className="tabla-status">Sin partidos para {equipo} con {golesEquipo1T} gol(es) en 1T.</p>
        )}
        {!error && !cargando && !resultados && <p className="tabla-status">Selecciona equipo y goles 1T, luego Fetch.</p>}
        {expandida ? <TablaAnalisisEquipo1TExpandida resultados={resultados} /> : <TablaAnalisisEquipo1T resultados={resultados} />}
      </section>
    </section>
  )
}
