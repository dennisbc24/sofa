import { useRef, useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { combinar2Partes } from "../dosPartes.js"
import { ambosMarcan, overLines } from "../mercados.js"

// Mismo límite que SubirEstadisticas: express admite 15mb.
const LOTE_MAX_BYTES = 6 * 1024 * 1024
const MAX_ARCHIVOS = 20

const fmt = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(2))
const pct = (v) => (v === null || v === undefined ? null : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`)
const ETIQUETA_1X2 = { home: "Local", draw: "Empate", away: "Visita" }

// Mercados derivados de las goles predichas (ambos marcan y cantidad de
// goles, para el 2T y para el partido completo). Se comparten con el
// historial (DosTDetalle).
export const MercadosGoles2T = ({ filas }) => {
  const g = (filas || []).find((f) => f.stat === "Goles")
  if (!g) return null
  const b2t = ambosMarcan(g.predLocal2T, g.predVisita2T)
  const hayFT = g.ftLocal != null && g.ftVisita != null
  const bft = hayFT ? ambosMarcan(g.ftLocal, g.ftVisita) : null
  const o2t = overLines((g.predLocal2T || 0) + (g.predVisita2T || 0))
  const oft = g.ftTotal != null ? overLines(g.ftTotal) : null
  if (!b2t && !bft && !o2t && !oft) return null
  const goles = [
    o2t && { t: "2T", local: fmt(g.predLocal2T), visita: fmt(g.predVisita2T), o: o2t },
    oft && { t: "Partido", local: fmt(g.ftLocal), visita: fmt(g.ftVisita), o: oft },
  ].filter(Boolean)
  return (
    <div className="mercados-grid">
      {(b2t || bft) && (
        <div className="mercado-bloque">
          <div className="mercado-titulo">Ambos marcan</div>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Ambato</th>
                  <th>Sí</th>
                  <th>No</th>
                </tr>
              </thead>
              <tbody>
                {b2t && (
                  <tr>
                    <td>2T</td>
                    <td className="tabla-num">
                      <strong>{b2t.si}%</strong>
                    </td>
                    <td className="tabla-num">{b2t.no}%</td>
                  </tr>
                )}
                {bft && (
                  <tr>
                    <td>Partido</td>
                    <td className="tabla-num">
                      <strong>{bft.si}%</strong>
                    </td>
                    <td className="tabla-num">{bft.no}%</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {goles.length > 0 && (
        <div className="mercado-bloque">
          <div className="mercado-titulo">Goles (esperados)</div>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Tiempo</th>
                  <th>Local</th>
                  <th>Visita</th>
                  <th>Total</th>
                  <th>+0.5</th>
                  <th>+1.5</th>
                  <th>+2.5</th>
                </tr>
              </thead>
              <tbody>
                {goles.map((row) => (
                  <tr key={row.t}>
                    <td>{row.t}</td>
                    <td className="tabla-num">{row.local}</td>
                    <td className="tabla-num">{row.visita}</td>
                    <td className="tabla-num">{row.o.esperados}</td>
                    <td className="tabla-num">{row.o.o05}%</td>
                    <td className="tabla-num">{row.o.o15}%</td>
                    <td className="tabla-num">{row.o.o25}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Lectura ligera del JSON para previsualizar (sin tocar el backend).
const previsualizar = (contenido) => {
  try {
    const j = JSON.parse(contenido)
    const ev = j && j.info && j.info.event
    if (!ev || !ev.id) return { valido: false, texto: "no es un dump de partido" }
    return {
      valido: true,
      partido: `${ev.homeTeam?.name ?? "?"} vs ${ev.awayTeam?.name ?? "?"}`,
      fecha: ev.startTimestamp
        ? new Date(ev.startTimestamp * 1000).toISOString().slice(0, 10)
        : "—",
      liga: ev.tournament?.name || "—",
      alDescanso: ev.status?.description || "—",
    }
  } catch {
    return { valido: false, texto: "JSON inválido" }
  }
}

export const Prediccion2T = () => {
  const [carpeta, setCarpeta] = useState("")
  const [archivos, setArchivos] = useState([])
  const [cargando, setCargando] = useState(false)
  const [progreso, setProgreso] = useState("")
  const [resultados, setResultados] = useState(null)
  const [error, setError] = useState(null)
  const [pestana, setPestana] = useState(0)
  const [parteInfo, setParteInfo] = useState(null)
  const [parteStats, setParteStats] = useState(null)
  const carpetaRef = useRef(null)
  const sueltosRef = useRef(null)
  const infoRef = useRef(null)
  const statsRef = useRef(null)

  const limpiarPartes = () => {
    setParteInfo(null)
    setParteStats(null)
    if (infoRef.current) infoRef.current.value = ""
    if (statsRef.current) statsRef.current.value = ""
  }

  const limpiar = () => {
    setCarpeta("")
    setArchivos([])
    setResultados(null)
    setError(null)
    setProgreso("")
    setPestana(0)
    limpiarPartes()
    if (carpetaRef.current) carpetaRef.current.value = ""
    if (sueltosRef.current) sueltosRef.current.value = ""
  }

  const cargar = async (lista, origen) => {
    setResultados(null)
    setError(null)
    limpiarPartes()
    const jsons = lista.filter((f) => f.name.toLowerCase().endsWith(".json"))
    if (!jsons.length) {
      setArchivos([])
      setError("La selección no contiene archivos .json")
      return
    }
    if (jsons.length > MAX_ARCHIVOS) {
      setArchivos([])
      setError(`Máximo ${MAX_ARCHIVOS} archivos por predicción (seleccionaste ${jsons.length}).`)
      return
    }
    setCarpeta(origen)
    const leidos = await Promise.all(
      jsons.map(async (f) => {
        const contenido = await f.text()
        return {
          nombre: f.webkitRelativePath || f.name,
          tam: f.size,
          contenido,
          vista: previsualizar(contenido),
        }
      })
    )
    setArchivos(leidos)
  }

  const seleccionarCarpeta = (e) => cargar(Array.from(e.target.files || []), "carpeta")
  const seleccionarSueltos = (e) => cargar(Array.from(e.target.files || []), "archivos sueltos")

  // Subida en 2 partes (extracto del celular): info.json + stats.json se
  // combinan en un único dump y se agrega como UN archivo a predecir.
  const seleccionarParte = (cual) => async (e) => {
    const f = (e.target.files || [])[0]
    setResultados(null)
    const nuevo = f ? { nombre: f.name, contenido: await f.text() } : null
    const info = cual === "info" ? nuevo : parteInfo
    const stats = cual === "stats" ? nuevo : parteStats
    if (cual === "info") setParteInfo(nuevo)
    else setParteStats(nuevo)

    if (!info || !stats) {
      setArchivos([])
      setCarpeta("")
      setError(info || stats ? "Faltan las 2 partes: selecciona info.json y stats.json." : null)
      return
    }
    const r = combinar2Partes(info.contenido, stats.contenido)
    if (!r.ok) {
      setArchivos([])
      setCarpeta("")
      setError(r.error)
      return
    }
    const contenido = r.contenido
    setArchivos([
      {
        nombre: `2partes_${r.partido.id}.json`,
        tam: contenido.length,
        contenido,
        vista: previsualizar(contenido),
      },
    ])
    setCarpeta("2 partes (info.json + stats.json)")
    setError(null)
  }

  const predecir = async () => {
    if (!archivos.length || cargando) return
    setCargando(true)
    setError(null)
    setResultados(null)
    setPestana(0)

    const lotes = []
    let actual = []
    let bytes = 0
    for (const a of archivos) {
      if (actual.length && bytes + a.tam > LOTE_MAX_BYTES) {
        lotes.push(actual)
        actual = []
        bytes = 0
      }
      actual.push(a)
      bytes += a.tam
    }
    if (actual.length) lotes.push(actual)

    const acum = { resultados: [], resumen: { archivos: 0, ok: 0, errores: 0 } }
    try {
      for (let i = 0; i < lotes.length; i++) {
        setProgreso(`Prediciendo lote ${i + 1} de ${lotes.length}…`)
        const res = await axios.post(`${API_URL}/api/predictions/2t`, {
          files: lotes[i].map((a) => ({ nombre: a.nombre, contenido: a.contenido })),
        })
        acum.resultados.push(...res.data.resultados)
        acum.resumen.archivos += res.data.resumen.archivos
        acum.resumen.ok += res.data.resumen.ok
        acum.resumen.errores += res.data.resumen.errores
        setResultados({
          ...acum,
          resultados: [...acum.resultados],
          resumen: { ...acum.resumen },
        })
      }
    } catch (err) {
      console.error("Error al predecir 2T:", err)
      setError(err.response?.data?.message || "Error al predecir el 2T.")
      if (acum.resultados.length) {
        setResultados({
          ...acum,
          resultados: [...acum.resultados],
          resumen: { ...acum.resumen },
        })
      }
    } finally {
      setCargando(false)
      setProgreso("")
    }
  }

  const validos = archivos.filter((a) => a.vista.valido).length

  const total = resultados?.resultados?.length || 0
  const idxActiva = total ? Math.min(pestana, total - 1) : 0
  const activo = total ? resultados.resultados[idxActiva] : null

  return (
    <section className="prediccion-2t">
      <h2 className="view-title">Proyección 2T (modelo de análisis)</h2>

      <section className="card">
        <div className="card-header">Partidos al descanso</div>
        <label className="field">
          <span className="field-label">
            Carpeta con los JSON de partidos en juego (1 por partido, formato Sofascore)
          </span>
          <input
            ref={carpetaRef}
            className="field-input"
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            accept=".json,application/json"
            onChange={seleccionarCarpeta}
            disabled={cargando}
          />
        </label>
        <label className="field">
          <span className="field-label">…o archivos .json sueltos</span>
          <input
            ref={sueltosRef}
            className="field-input"
            type="file"
            multiple
            accept=".json,application/json"
            onChange={seleccionarSueltos}
            disabled={cargando}
          />
        </label>
        <label className="field">
          <span className="field-label">
            …o desde el celular en 2 partes — parte 1: info.json (evento del partido)
          </span>
          <input
            ref={infoRef}
            className="field-input"
            type="file"
            accept=".json,application/json"
            onChange={seleccionarParte("info")}
            disabled={cargando}
          />
        </label>
        <label className="field">
          <span className="field-label">…parte 2: stats.json (estadísticas del 1T)</span>
          <input
            ref={statsRef}
            className="field-input"
            type="file"
            accept=".json,application/json"
            onChange={seleccionarParte("stats")}
            disabled={cargando}
          />
        </label>
        <ul className="explicacion">
          <li>El modelo estima el 2T con las estadísticas del 1T del JSON + el historial de la base de datos.</li>
          <li>Predice goles, remates, corners, amarillas y 37 stats más (41 en total).</li>
          <li>Sólo lectura: los archivos NO se guardan en la base de datos.</li>
          <li>Desde el celular: sube info.json y stats.json por separado — se combinan automáticamente.</li>
        </ul>
        {carpeta && (
          <p className="tabla-status">
            {carpeta} — {archivos.length} archivo(s) .json detectado(s)
            {archivos.length !== validos ? ` (${archivos.length - validos} inválido(s))` : ""}
          </p>
        )}
      </section>

      {archivos.length > 0 && (
        <section className="card">
          <div className="card-header">Archivos detectados ({archivos.length})</div>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Partido</th>
                  <th>Fecha</th>
                  <th>Liga</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {archivos.map((a) => (
                  <tr key={a.nombre}>
                    <td>{a.nombre}</td>
                    <td className={a.vista.valido ? "" : "tabla-status-error"}>
                      {a.vista.valido ? a.vista.partido : a.vista.texto}
                    </td>
                    <td className="tabla-num">{a.vista.valido ? a.vista.fecha : "—"}</td>
                    <td>{a.vista.valido ? a.vista.liga : "—"}</td>
                    <td>{a.vista.valido ? a.vista.alDescanso : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="actions">
        <button className="btn btn-secondary" onClick={limpiar} disabled={cargando}>
          Limpiar
        </button>
        <button
          className="btn btn-primary"
          onClick={predecir}
          disabled={!archivos.length || cargando || !validos}
        >
          {cargando ? "Prediciendo..." : `Predecir 2T (${archivos.length || ""})`}
        </button>
      </div>

      {progreso && <p className="tabla-status">{progreso}</p>}
      {error && <p className="tabla-status tabla-status-error">{error}</p>}

      {resultados && (
        <>
          <section className="card">
            <div className="card-header">Resumen</div>
            <div className="result-row">
              <span className="result-label">Archivos procesados</span>
              <span className="result-value">{resultados.resumen.archivos}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Predicciones OK</span>
              <span className="result-value">{resultados.resumen.ok}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Errores</span>
              <span className="result-value">{resultados.resumen.errores}</span>
            </div>
          </section>

          <div className="tabs tabs-pestanas" role="tablist">
            {resultados.resultados.map((r, i) => (
              <button
                key={r.archivo || r.partido?.id || i}
                role="tab"
                aria-selected={i === idxActiva}
                className={`tab ${i === idxActiva ? "tab-active" : ""}`}
                onClick={() => setPestana(i)}
                title={
                  r.accion === "error"
                    ? r.archivo
                    : `${r.partido.local} vs ${r.partido.visitante} — ${r.partido.fecha}`
                }
              >
                {r.accion === "error"
                  ? `⚠ ${String(r.archivo || "").split("/").pop()}`
                  : `${r.partido.local} vs ${r.partido.visitante}`}
              </button>
            ))}
          </div>

          {activo?.accion === "error" ? (
            <section className="card" key={activo.archivo}>
              <div className="card-header">{activo.archivo}</div>
              <p className="tabla-status tabla-status-error">{activo.message}</p>
            </section>
          ) : activo ? (
            <section className="card" key={activo.archivo || activo.partido?.id || activo.partido?.fecha}>
              <div className="card-header">
                {activo.partido.local} vs {activo.partido.visitante} — {activo.partido.fecha}
                {activo.partido.liga ? ` — ${activo.partido.liga}` : ""}
              </div>

              <div className="result-row">
                <span className="result-label">Modelo</span>
                <span className="result-value">
                  <span className={`resultado-chip ${activo.modelo.estado === "BETA" ? "resultado-e" : "resultado-v"}`}>
                    {activo.modelo.id || activo.modelo.name} {activo.modelo.estado ? `(${activo.modelo.estado})` : ""}
                  </span>{" "}
                  {activo.historial.local} partidos de {activo.partido.local}, {activo.historial.visitante} de{" "}
                  {activo.partido.visitante} (cutoff)
                </span>
              </div>
              <div className="result-row">
                <span className="result-label">Backtest (MAE TEST)</span>
                <span className="result-value">
                  {["Goles", "Total shots", "Corner kicks", "Yellow cards"]
                    .map((k) => {
                      const bt = activo.modelo.backtestPrincipales?.[k]
                      if (!bt) return null
                      const label = { Goles: "Goles", "Total shots": "Remates", "Corner kicks": "Corners", "Yellow cards": "Amarillas" }[k]
                      if (bt.mae_proyeccion2T_TEST) {
                        const d = ((bt.mae_proyeccion2T_TEST - bt.mae_modelo_TEST) / bt.mae_proyeccion2T_TEST) * 100
                        return `${label} ${pct(d)}`
                      }
                      return `${label} vs peor baseline ${pct(((bt.mae_mejor_baseline_TEST - bt.mae_modelo_TEST) / bt.mae_mejor_baseline_TEST) * 100)}`
                    })
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>

              {activo.advertencias && activo.advertencias.length > 0 && (
                <p className="tabla-status">{activo.advertencias.join(" ")}</p>
              )}

              {activo.resultado1x2 && (
                <div className="result-row">
                  <span className="result-label">Resultado final (1X2)</span>
                  <span className="result-value">
                    <span className="resultado-chip resultado-e">
                      {ETIQUETA_1X2[activo.resultado1x2.prediccion]} ({activo.resultado1x2.probabilidad}%)
                    </span>{" "}
                    Local {activo.resultado1x2.probabilidades.home}% · Empate{" "}
                    {activo.resultado1x2.probabilidades.draw}% · Visita{" "}
                    {activo.resultado1x2.probabilidades.away}% · goles esperados{" "}
                    {activo.resultado1x2.golesEsperados.local}-
                    {activo.resultado1x2.golesEsperados.visita}
                  </span>
                </div>
              )}

              <MercadosGoles2T filas={activo.filas} />

              <div className="tabla-scroll">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Stat</th>
                      <th>1T</th>
                      <th>Local</th>
                      <th>Visita</th>
                      <th>FT Local</th>
                      <th>FT Visita</th>
                      <th>FT Total</th>
                      <th>Fuente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activo.filas.map((f) => (
                      <tr key={f.stat}>
                        <td>{f.etiqueta}</td>
                        <td className="tabla-num">
                          {f.local1T === null || f.local1T === undefined
                            ? "—"
                            : `${fmt(f.local1T)}-${fmt(f.visita1T)}`}
                        </td>
                        <td className="tabla-num">{fmt(f.predLocal2T)}</td>
                        <td className="tabla-num">{fmt(f.predVisita2T)}</td>
                        <td className="tabla-num">{f.ftLocal !== undefined ? fmt(f.ftLocal) : "—"}</td>
                        <td className="tabla-num">{f.ftVisita !== undefined ? fmt(f.ftVisita) : "—"}</td>
                        <td className="tabla-num">{f.ftTotal !== undefined ? fmt(f.ftTotal) : "—"}</td>
                        <td>
                          <span className={`resultado-chip ${f.fuente === "historial" ? "resultado-e" : "resultado-v"}`}>
                            {f.fuente === "historial" ? "Historial" : f.fuente}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  )
}
