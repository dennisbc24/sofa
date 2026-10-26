import { useRef, useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { combinar2Partes, combinar3Partes } from "../dosPartes.js"
import { ambosMarcan, clasePrevisibilidad, fondoPrevisibilidad, masMenos, overDinamicas, overLines, previsibilidadConjunta, textoOver } from "../mercados.js"
import { BloqueNoPierde, BloquePrevisibilidad } from "./PrediccionSecciones.jsx"
import { CeldaMasMenos } from "./CeldaMasMenos.jsx"
import { CardPrediccion1x2 } from "./CardPrediccion1x2.jsx"
import { formatearFecha } from "../utils.js"

// Mismo límite que SubirEstadisticas: express admite 15mb.
const LOTE_MAX_BYTES = 6 * 1024 * 1024
const MAX_ARCHIVOS = 20

const fmt = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(2))
const pct = (v) => (v === null || v === undefined ? null : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`)

// Mercados derivados de la proyección 2T (ambos marcan y cantidad de goles,
// corners y remates, para el 2T y para el partido completo). Se comparten
// con el historial (DosTDetalle).
// `reales`: valores reales del partido (si ya está en la base) para pintar
// la columna Más/Menos en verde (acierto) / rojo (fallo).
export const MercadosGoles2T = ({ filas, reales, local, visitante, previsibilidad, noPierde }) => {
  const fila = (nombre) => (filas || []).find((f) => f.stat === nombre)
  const g = fila("Goles")
  if (!g) return null
  const pctLocal = (k) => previsibilidad?.local?.[k]
  const pctVisita = (k) => previsibilidad?.visita?.[k]
  const pctConjunto = (k) => previsibilidadConjunta(previsibilidad, k)
  const b2t = ambosMarcan(g.predLocal2T, g.predVisita2T)
  const hayFT = g.ftLocal != null && g.ftVisita != null
  const bft = hayFT ? ambosMarcan(g.ftLocal, g.ftVisita) : null
  const o2t = overLines((g.predLocal2T || 0) + (g.predVisita2T || 0))
  const oft = g.ftTotal != null ? overLines(g.ftTotal) : null
  const realG2T = reales?.goles?.["2T"]
  const realGFT = reales?.goles?.["Partido"]
  const goles = [
    o2t && { t: "2T", local: fmt(g.predLocal2T), visita: fmt(g.predVisita2T), o: o2t, real: realG2T },
    oft && { t: "Partido", local: fmt(g.ftLocal), visita: fmt(g.ftVisita), o: oft, real: realGFT },
  ].filter(Boolean)
  // Corners y remates: mismos campos de la fila (pred 2T + FT del whitelist).
  const statRows = (nombre) => {
    const f = fila(nombre)
    if (!f || f.predLocal2T == null || f.predVisita2T == null) return []
    const t2 = (f.predLocal2T || 0) + (f.predVisita2T || 0)
    const real2T = reales?.[nombre === "Corner kicks" ? "corners" : "remates"]?.["2T"]
    const realFT = reales?.[nombre === "Corner kicks" ? "corners" : "remates"]?.["Partido"]
    const rows = [{ t: "2T", local: fmt(f.predLocal2T), visita: fmt(f.predVisita2T), total: fmt(t2), totalNum: t2, over: overDinamicas(t2), real: real2T }]
    if (f.ftLocal != null && f.ftVisita != null && f.ftTotal != null) {
      rows.push({ t: "Partido", local: fmt(f.ftLocal), visita: fmt(f.ftVisita), total: fmt(f.ftTotal), totalNum: f.ftTotal, over: overDinamicas(f.ftTotal), real: realFT })
    }
    return rows
  }
  const corners = statRows("Corner kicks")
  const remates = statRows("Total shots")
  const BloqueCantidad = ({ titulo, rows, equipoKey, totalKey }) =>
    rows.length > 0 ? (
      <div className="mercado-bloque">
        <div className="mercado-titulo">{titulo}</div>
        <div className="tabla-scroll">
          <table className="tabla">
            <thead>
                <tr>
                  <th>Tiempo</th>
                  <th className="th-equipo">{local || "Local"}</th>
                  <th className="th-equipo">{visitante || "Visita"}</th>
                  <th className="col-total">Total</th>
                  <th>Over</th>
                  <th>Más/Menos</th>
                </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.t} className={row.t === "Partido" ? "fila-total" : undefined}>
                  <td>{row.t}</td>
                  <td className={`tabla-num ${clasePrevisibilidad(pctLocal(equipoKey))}`} style={fondoPrevisibilidad(pctLocal(equipoKey))}>{row.local}</td>
                  <td className={`tabla-num ${clasePrevisibilidad(pctVisita(equipoKey))}`} style={fondoPrevisibilidad(pctVisita(equipoKey))}>{row.visita}</td>
                  <td className={`tabla-num col-total ${clasePrevisibilidad(pctConjunto(totalKey))}`} style={fondoPrevisibilidad(pctConjunto(totalKey))}>{row.total}</td>
                  <td className="tabla-num">{textoOver(row.over)}</td>
                  <td className="tabla-num"><CeldaMasMenos mm={masMenos(row.totalNum)} real={row.real} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ) : null
  if (!b2t && !bft && goles.length === 0 && corners.length === 0 && remates.length === 0
    && !previsibilidad && !noPierde) return null
  return (
    <>
      <section className="card">
        <div className="card-header">Goles, remates y corners esperados (2T)</div>
        <div className="mercados-grid">
      {goles.length > 0 && (
        <div className="mercado-bloque">
          <div className="mercado-titulo">Goles (esperados)</div>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Tiempo</th>
                  <th className="th-equipo">{local || "Local"}</th>
                  <th className="th-equipo">{visitante || "Visita"}</th>
                  <th className="col-total">Total</th>
                  <th>+0.5</th>
                  <th>+1.5</th>
                  <th>+2.5</th>
                  <th>+3.5</th>
                  <th>Más/Menos</th>
                </tr>
              </thead>
              <tbody>
                {goles.map((row) => (
                  <tr key={row.t} className={row.t === "Partido" ? "fila-total" : undefined}>
                    <td>{row.t}</td>
                    <td className={`tabla-num ${clasePrevisibilidad(pctLocal("golesTotal"))}`} style={fondoPrevisibilidad(pctLocal("golesTotal"))}>{row.local}</td>
                    <td className={`tabla-num ${clasePrevisibilidad(pctVisita("golesTotal"))}`} style={fondoPrevisibilidad(pctVisita("golesTotal"))}>{row.visita}</td>
                    <td className={`tabla-num col-total ${clasePrevisibilidad(pctConjunto("golesTotal"))}`} style={fondoPrevisibilidad(pctConjunto("golesTotal"))}>{row.o.esperados}</td>
                    <td className="tabla-num">{row.o.o05}%</td>
                    <td className="tabla-num">{row.o.o15}%</td>
                    <td className="tabla-num">{row.o.o25}%</td>
                    <td className="tabla-num">{row.o.o35}%</td>
                    <td className="tabla-num"><CeldaMasMenos mm={masMenos(row.o.esperados)} real={row.real} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <BloqueCantidad titulo="Corners (esperados)" rows={corners} equipoKey="cornersTotal" totalKey="cornersTotal" />
      <BloqueCantidad titulo="Remates (esperados)" rows={remates} equipoKey="rematesEquipo" totalKey="rematesTotal" />
        </div>
      </section>

      <section className="card">
        <div className="card-header">Mercados adicionales (2T)</div>
        <div className="mercados-grid">
      {(previsibilidad || noPierde) && (
        <>
          <BloquePrevisibilidad previsibilidad={previsibilidad} local={local} visita={visitante} />
          <BloqueNoPierde fuente={noPierde} local={local} visita={visitante} />
        </>
      )}
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
        </div>
      </section>
    </>
  )
}

// Lectura ligera del JSON para previsualizar (sin tocar el backend).
// Acepta el formato viejo (info.event) y el nuevo (info + estadisticas +
// jugadores). El 2T solo usa info + stats.
const previsualizar = (contenido) => {
  try {
    const j = JSON.parse(contenido)
    const ev = j && j.info && j.info.event
    if (ev && ev.id) {
      return {
        valido: true,
        partido: `${ev.homeTeam?.name ?? "?"} vs ${ev.awayTeam?.name ?? "?"}`,
        fecha: ev.startTimestamp
          ? new Date(ev.startTimestamp * 1000).toISOString().slice(0, 10)
          : "—",
        liga: ev.tournament?.name || "—",
        alDescanso: ev.status?.description || "—",
      }
    }
    const info = j && j.info
    if (info && (info.home || info.away)) {
      return {
        valido: true,
        partido: `${info.home ?? "?"} vs ${info.away ?? "?"}`,
        fecha: info.fecha || "—",
        liga: info.torneo || "—",
        alDescanso: info.estado || "—",
      }
    }
    return { valido: false, texto: "no es un dump de partido" }
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
  const [partePlayers, setPartePlayers] = useState(null)
  const carpetaRef = useRef(null)
  const sueltosRef = useRef(null)
  const infoRef = useRef(null)
  const statsRef = useRef(null)
  const playersRef = useRef(null)

  const limpiarPartes = () => {
    setParteInfo(null)
    setParteStats(null)
    setPartePlayers(null)
    if (infoRef.current) infoRef.current.value = ""
    if (statsRef.current) statsRef.current.value = ""
    if (playersRef.current) playersRef.current.value = ""
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

  // Subida en partes (extracto del celular): info.json + stats.json (+
  // players.json opcional) se combinan en un único dump y se agrega como UN
  // archivo a predecir.
  const seleccionarParte = (cual) => async (e) => {
    const f = (e.target.files || [])[0]
    setResultados(null)
    const nuevo = f ? { nombre: f.name, contenido: await f.text() } : null
    const info = cual === "info" ? nuevo : parteInfo
    const stats = cual === "stats" ? nuevo : parteStats
    const players = cual === "players" ? nuevo : partePlayers
    if (cual === "info") setParteInfo(nuevo)
    else if (cual === "stats") setParteStats(nuevo)
    else setPartePlayers(nuevo)

    if (!info || !stats) {
      setArchivos([])
      setCarpeta("")
      setError(info || stats ? "Faltan las 2 partes: selecciona info.json y stats.json." : null)
      return
    }
    const r = players
      ? combinar3Partes(info.contenido, stats.contenido, players.contenido)
      : combinar2Partes(info.contenido, stats.contenido)
    if (!r.ok) {
      setArchivos([])
      setCarpeta("")
      setError(r.error)
      return
    }
    const contenido = r.contenido
    setArchivos([
      {
        nombre: `partes_${r.partido.id}.json`,
        tam: contenido.length,
        contenido,
        vista: previsualizar(contenido),
      },
    ])
    setCarpeta(
      players
        ? `3 partes (info.json + stats.json + players.json, ${r.partido.jugadores} jugadores)`
        : "2 partes (info.json + stats.json)"
    )
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
        <ul className="explicacion">
          <li>El modelo estima el 2T con las estadísticas del 1T del JSON + el historial de la base de datos.</li>
          <li>Predice goles, remates, corners, amarillas y 37 stats más (41 en total).</li>
          <li>Sólo lectura: los archivos NO se guardan en la base de datos.</li>
        </ul>
        {carpeta && (
          <p className="tabla-status">
            {carpeta} — {archivos.length} archivo(s) .json detectado(s)
            {archivos.length !== validos ? ` (${archivos.length - validos} inválido(s))` : ""}
          </p>
        )}
      </section>

      <section className="card card-celular">
        <div className="card-header">Carga desde el celular (por partes)</div>
        <p className="tabla-status">
          Si tu extractor sólo puede guardar los archivos por separado, súbelos aquí: se combinan
          automáticamente en un solo dump.
        </p>
        <label className="field">
          <span className="field-label">Parte 1: info.json (evento del partido)</span>
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
          <span className="field-label">Parte 2: stats.json (estadísticas del 1T)</span>
          <input
            ref={statsRef}
            className="field-input"
            type="file"
            accept=".json,application/json"
            onChange={seleccionarParte("stats")}
            disabled={cargando}
          />
        </label>
        <label className="field">
          <span className="field-label">
            Parte 3 (opcional): players.json (stats y alineación por jugador)
          </span>
          <input
            ref={playersRef}
            className="field-input"
            type="file"
            accept=".json,application/json"
            onChange={seleccionarParte("players")}
            disabled={cargando}
          />
        </label>
        <ul className="explicacion">
          <li>Con info.json + stats.json basta para proyectar el 2T (el modelo usa info + stats).</li>
          <li>Si también subes players.json, se incluye la alineación y los datos por jugador.</li>
        </ul>
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

              {activo.resultado1x2 && (() => {
                const r1 = activo.resultado1x2
                // Resultado real (si el partido ya está en la base).
                const gp = activo.reales?.goles?.["Partido"]
                const real = gp ? (gp.l > gp.v ? "home" : gp.l < gp.v ? "away" : "draw") : null
                return (
                  <CardPrediccion1x2
                    titulo="Predicción final (2T)"
                    local={activo.partido?.local}
                    visitante={activo.partido?.visitante}
                    fecha={activo.partido?.fecha ? formatearFecha(activo.partido.fecha) : null}
                    probabilidades={r1.probabilidades}
                    predicho={r1.prediccion}
                    probabilidad={r1.probabilidad}
                    real={real}
                    marcador={gp}
                    chip={
                      <span className="modelo-chip">
                        {activo.modelo?.id || activo.modelo?.name}
                      </span>
                    }
                    nota={`Proyección estadística del 2T con fines analíticos: estima probabilidades, no garantiza resultados. Goles esperados final: ${r1.golesEsperados?.local}-${r1.golesEsperados?.visita}.`}
                  />
                )
              })()}

      <MercadosGoles2T
        filas={activo.filas}
        reales={activo.reales}
        local={activo.partido?.local}
        visitante={activo.partido?.visitante}
        previsibilidad={activo.previsibilidad}
        noPierde={activo}
      />

              <div className="tabla-scroll">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Stat</th>
                      <th>1T</th>
                      <th className="th-equipo">{activo.partido?.local || "Local"}</th>
                      <th className="th-equipo">{activo.partido?.visitante || "Visita"}</th>
                      <th>FT {activo.partido?.local || "Local"}</th>
                      <th>FT {activo.partido?.visitante || "Visita"}</th>
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
