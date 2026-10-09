import { useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { BuscadorEquipo } from "./BuscadorEquipo.jsx"
import { Desplegable } from "./Desplegable.jsx"
import { SeccionesAnalisis } from "./PrediccionSecciones.jsx"
import { formatearFecha, formatearFechaHora } from "../utils.js"

const hoy = () => new Date().toISOString().slice(0, 10)

export const AnalisisPredictivo = () => {
  const [local, setLocal] = useState("")
  const [visita, setVisita] = useState("")
  const [liga, setLiga] = useState("")
  const [fecha, setFecha] = useState(hoy())
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  const limpiar = () => {
    setLocal("")
    setVisita("")
    setLiga("")
    setFecha(hoy())
    setDatos(null)
    setError(null)
  }

  const analizar = async () => {
    if (!local || !visita) {
      setError("Selecciona el equipo local y el visitante.")
      return
    }
    setCargando(true)
    setError(null)
    try {
      const res = await axios.get(`${API_URL}/api/predictions/match`, {
        params: { localTeam: local, awayTeam: visita, date: fecha, league: liga },
      })
      setDatos(res.data)
    } catch (err) {
      console.error("Error al consultar el análisis predictivo:", err)
      setError(err.response?.data?.message || "Error al consultar el análisis predictivo.")
      setDatos(null)
    } finally {
      setCargando(false)
    }
  }

  const probs = datos
    ? [
        { etiqueta: "Local", valor: datos.probabilities.home },
        { etiqueta: "Empate", valor: datos.probabilities.draw },
        { etiqueta: "Visita", valor: datos.probabilities.away },
      ]
    : []
  const favorito = probs.length ? probs.reduce((a, b) => (a.valor >= b.valor ? a : b)) : null
  // Predicción principal según el API (mismo argmax que el backend)
  const predPrinc = datos?.prediction
    ? { etiqueta: datos.prediction.mainLabel, valor: datos.prediction.probability }
    : favorito

  return (
    <section className="analisis-predictivo">
      <h2 className="view-title">Análisis predictivo (1X2)</h2>

      <section className="card">
        <div className="card-header">Equipos y fecha</div>
        <label className="field">
          <span className="field-label">
            Equipo local {local && <span className="modelo-chip">{local}</span>}
          </span>
          <BuscadorEquipo onSelect={setLocal} />
        </label>
        <label className="field">
          <span className="field-label">
            Equipo visitante {visita && <span className="modelo-chip">{visita}</span>}
          </span>
          <BuscadorEquipo onSelect={setVisita} />
        </label>
        <label className="field">
          <span className="field-label">Fecha de corte (solo historia anterior a esta fecha)</span>
          <input
            className="field-input"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>
        <Desplegable onChange={(e) => setLiga(e.target.value)} />
        {liga && (
          <p className="tabla-status">
            Liga seleccionada: {liga}{" "}
            <button className="btn-link" onClick={() => setLiga("")}>quitar</button>
          </p>
        )}
      </section>

      <div className="actions">
        <button className="btn btn-secondary" onClick={limpiar}>Limpiar</button>
        <button className="btn btn-primary" onClick={analizar} disabled={cargando}>
          {cargando ? "Analizando..." : "Analizar"}
        </button>
      </div>

      {error && <p className="tabla-status tabla-status-error">{error}</p>}

      {datos && (
        <>
          <section className="card">
            <div className="card-header">
              Predicción — {datos.match.homeTeam} vs {datos.match.awayTeam}
              <span className="modelo-chip">{datos.model}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Partido</span>
              <span className="result-value">{datos.match.homeTeam} vs {datos.match.awayTeam}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Fecha del partido</span>
              <span className="result-value">{formatearFecha(datos.match.date)}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Predicción principal</span>
              <span className="result-value">
                {predPrinc ? `${predPrinc.etiqueta} (${predPrinc.valor}%)` : "—"}
              </span>
            </div>
            <div className="prob-grid">
              {probs.map((p) => (
                <div
                  key={p.etiqueta}
                  className={`prob-item ${favorito && p.etiqueta === favorito.etiqueta ? "prob-item-fav" : ""}`}
                >
                  <div className="prob-etiqueta">{p.etiqueta}</div>
                  <div className="prob-valor">{p.valor}%</div>
                  <div className="prob-barra">
                    <span style={{ width: `${p.valor}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="tabla-status">
              Predicción probabilística del modelo {datos.model} (versión {datos.modelVersion}): estima
              probabilidades, no es una certeza ni una recomendación de apuesta.
            </p>
            <p className="tabla-status">
              Goles esperados: {datos.lambdas.home} (local) · {datos.lambdas.away} (visita).
              Modelo {datos.modelInfo.name} v{datos.modelInfo.version}, entrenado el{" "}
              {formatearFechaHora(datos.modelInfo.entrenadoEn)}.
            </p>
            {datos.advertencias.length > 0 && (
              <ul className="explicacion">
                {datos.advertencias.map((a) => (
                  <li key={a} className="advertencia">⚠ {a}</li>
                ))}
              </ul>
            )}
          </section>

          <SeccionesAnalisis datos={datos} />
        </>
      )}
    </section>
  )
}
