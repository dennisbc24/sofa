import { useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { BuscadorEquipo } from "./BuscadorEquipo.jsx"
import { Desplegable } from "./Desplegable.jsx"
import { formatearFecha, formatearFechaHora } from "../utils.js"

const hoy = () => new Date().toISOString().slice(0, 10)

const FILAS_TIEMPO = [
  { key: "gf_t1", etiqueta: "Goles a favor 1T" },
  { key: "gf_t2", etiqueta: "Goles a favor 2T" },
  { key: "gc_t1", etiqueta: "Goles en contra 1T" },
  { key: "gc_t2", etiqueta: "Goles en contra 2T" },
  { key: "xg_t1", etiqueta: "xG 1T" },
  { key: "remates_t1", etiqueta: "Remates 1T" },
  { key: "al_arco_t1", etiqueta: "Remates al arco 1T" },
  { key: "corners_t1", etiqueta: "Corners 1T" },
]

const redondear = (v) => (v === null || v === undefined ? "—" : Math.round(v * 100) / 100)

export const FormaEquipo = ({ titulo, perfil }) => {
  const f = perfil.forma
  return (
    <section className="card">
      <div className="card-header">{titulo}</div>
      <table className="tabla">
        <thead>
          <tr>
            <th>Periodo</th>
            <th>V</th>
            <th>E</th>
            <th>D</th>
            <th>%Vict</th>
            <th>GF</th>
            <th>GC</th>
          </tr>
        </thead>
        <tbody>
          {[["Últimos 5", f.ultimos5], ["Últimos 10", f.ultimos10], ["Últimos 20", f.ultimos20]].map(
            ([etiqueta, fila]) => (
              <tr key={etiqueta}>
                <td>{etiqueta}</td>
                <td className="tabla-num">{fila.victorias}</td>
                <td className="tabla-num">{fila.empates}</td>
                <td className="tabla-num">{fila.derrotas}</td>
                <td className="tabla-num">{fila.pctVictorias}%</td>
                <td className="tabla-num">{fila.golesFavor}</td>
                <td className="tabla-num">{fila.golesContra}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
      <div className="card-header" style={{ marginTop: 12 }}>Últimos partidos</div>
      <ul className="lista-recientes">
        {perfil.recientes.map((p) => (
          <li key={p.fecha + p.rival} className="reciente-item">
            <span className="reciente-fecha">{formatearFecha(p.fecha)}</span>
            <span className={`resultado-chip resultado-${p.resultado.toLowerCase()}`}>{p.resultado}</span>
            <span className="reciente-rival">
              ({p.condicion}) {p.rival} {p.gf}-{p.gc}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

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
        <div className="card-header">Selección</div>
        <div className="result-row">
          <span className="result-label">Local</span>
          <span className="result-value">{local || "—"}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Visitante</span>
          <span className="result-value">{visita || "—"}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Fecha del partido</span>
          <span className="result-value">{fecha ? formatearFecha(fecha) : "—"}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Liga (opcional)</span>
          <span className="result-value">{liga || "General"}</span>
        </div>
      </section>

      <section className="card">
        <div className="card-header">Equipos y fecha</div>
        <label className="field">
          <span className="field-label">Equipo local</span>
          <BuscadorEquipo onSelect={setLocal} />
        </label>
        <label className="field">
          <span className="field-label">Equipo visitante</span>
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

          <section className="card">
            <div className="card-header">
              Comparación — {datos.homeFeatures.equipo} (local) vs {datos.awayFeatures.equipo} (visita)
            </div>
            <p className="tabla-status">
              Fuente: {datos.homeFeatures.fuenteStats === "local" && datos.awayFeatures.fuenteStats === "visita"
                ? "partidos en la condición del partido (local vs local, visita vs visita)"
                : "historial general (alguno de los equipos tiene < 3 partidos en su condición)"}
            </p>
            <div className="tabla-scroll">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Métrica</th>
                    <th>{datos.homeFeatures.equipo}</th>
                    <th>{datos.awayFeatures.equipo}</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.comparison.map((c) => (
                    <tr key={c.metrica}>
                      <td>{c.metrica}</td>
                      <td className={`tabla-num ${c.ventaja === "local" ? "ventaja-local" : ""}`}>
                        {c.local ?? "—"}
                      </td>
                      <td className={`tabla-num ${c.ventaja === "visita" ? "ventaja-local" : ""}`}>
                        {c.visitante ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="dos-col">
            <FormaEquipo titulo={`Forma — ${datos.homeFeatures.equipo}`} perfil={datos.homeFeatures} />
            <FormaEquipo titulo={`Forma — ${datos.awayFeatures.equipo}`} perfil={datos.awayFeatures} />
          </div>

          <section className="card">
            <div className="card-header">Por tiempo (1T / 2T)</div>
            <div className="tabla-scroll">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Métrica</th>
                    <th>{datos.homeFeatures.equipo}</th>
                    <th>{datos.awayFeatures.equipo}</th>
                  </tr>
                </thead>
                <tbody>
                  {FILAS_TIEMPO.map((f) => (
                    <tr key={f.key}>
                      <td>{f.etiqueta}</td>
                      <td className="tabla-num">{redondear(datos.homeFeatures.statsComparadas[f.key])}</td>
                      <td className="tabla-num">{redondear(datos.awayFeatures.statsComparadas[f.key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="card-header">Enfrentamientos directos (H2H)</div>
            {datos.headToHead.resumen.n === 0 ? (
              <p className="tabla-status">Sin enfrentamientos directos previos antes de {formatearFecha(datos.match.date)}.</p>
            ) : (
              <>
                <p className="tabla-status">
                  {datos.headToHead.resumen.n} partido(s) — para {datos.homeFeatures.equipo}:{" "}
                  {datos.headToHead.resumen.victorias}v {datos.headToHead.resumen.empates}e{" "}
                  {datos.headToHead.resumen.derrotas}d (de local{" "}
                  {datos.headToHead.resumen.comoLocal.victorias}-{datos.headToHead.resumen.comoLocal.empates}-
                  {datos.headToHead.resumen.comoLocal.derrotas}, de visita{" "}
                  {datos.headToHead.resumen.comoVisitante.victorias}-{datos.headToHead.resumen.comoVisitante.empates}-
                  {datos.headToHead.resumen.comoVisitante.derrotas}), promedio{" "}
                  {datos.headToHead.resumen.promedioGoles} goles.
                </p>
                <div className="tabla-scroll">
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Local</th>
                        <th>Marcador</th>
                        <th>Visita</th>
                        <th>{datos.homeFeatures.equipo}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.headToHead.partidos.map((p) => (
                        <tr key={p.fecha + p.equipo_local}>
                          <td>{formatearFecha(p.fecha)}</td>
                          <td className={p.equipoLocalEsLocal ? "tabla-equipo" : ""}>{p.equipo_local}</td>
                          <td className="tabla-num">{p.goles_local}-{p.goles_visitante}</td>
                          <td className={!p.equipoLocalEsLocal ? "tabla-equipo" : ""}>{p.equipo_visitante}</td>
                          <td className={`resultado-chip resultado-${p.resultadoParaLocal.toLowerCase()}`}>
                            {p.resultadoParaLocal}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="card">
            <div className="card-header">Explicación del modelo</div>
            <ul className="explicacion">
              {datos.explanation.map((frase) => (
                <li key={frase}>{frase}</li>
              ))}
            </ul>
          </section>

          <section className="card card-clara">
            <div className="card-header">Datos y backtest</div>
            <div className="result-row">
              <span className="result-label">Fecha de corte</span>
              <span className="result-value">{formatearFecha(datos.datosUtilizados.fechaCorte)}</span>
            </div>
            <div className="result-row">
              <span className="result-label">{datos.datosUtilizados.local.condicion === "local" ? "Local (como local)" : "Local (general)"}</span>
              <span className="result-value">
                {datos.datosUtilizados.local.partidos} partidos · {formatearFecha(datos.datosUtilizados.local.desde)} → {formatearFecha(datos.datosUtilizados.local.hasta)}
              </span>
            </div>
            <div className="result-row">
              <span className="result-label">{datos.datosUtilizados.visitante.condicion === "visita" ? "Visita (como visita)" : "Visita (general)"}</span>
              <span className="result-value">
                {datos.datosUtilizados.visitante.partidos} partidos · {formatearFecha(datos.datosUtilizados.visitante.desde)} → {formatearFecha(datos.datosUtilizados.visitante.hasta)}
              </span>
            </div>
            <div className="result-row">
              <span className="result-label">Muestra del modelo</span>
              <span className="result-value">
                {datos.modelInfo.muestra?.partidos} partidos, {datos.modelInfo.muestra?.equipos} equipos
                ({formatearFecha(datos.modelInfo.muestra?.desde)} → {formatearFecha(datos.modelInfo.muestra?.hasta)})
              </span>
            </div>
            {datos.modelInfo.backtest?.test && (
              <>
                <div className="result-row">
                  <span className="result-label">Test (accuracy / log loss / Brier)</span>
                  <span className="result-value">
                    {(datos.modelInfo.backtest.test.accuracy * 100).toFixed(2)}% · {datos.modelInfo.backtest.test.logLoss} · {datos.modelInfo.backtest.test.brier}
                  </span>
                </div>
                <div className="result-row">
                  <span className="result-label">Baseline en test</span>
                  <span className="result-value">{(datos.modelInfo.backtest.baselineTest * 100).toFixed(2)}%</span>
                </div>
              </>
            )}
            <p className="tabla-status">{datos.modelInfo.backtest?.nota}</p>
          </section>
        </>
      )}
    </section>
  )
}
