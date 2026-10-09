import { useRef, useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import useFetch from "../hooks/useFetch.jsx"
import { combinar2Partes } from "../dosPartes.js"

// ~6MB por request: express admite 15mb y nginx 20M en prod.
const LOTE_MAX_BYTES = 6 * 1024 * 1024

const CHIPS = {
  creado: "resultado-v",
  actualizado: "resultado-v",
  saltado: "resultado-e",
  error: "resultado-d",
}
const ETIQUETAS = {
  creado: "Creado",
  actualizado: "Cabecera",
  saltado: "Saltado",
  error: "Error",
}

const resumenVacio = () => ({
  archivos: 0,
  creados: 0,
  actualizados: 0,
  saltados: 0,
  errores: 0,
  filas_insertadas: 0,
})

// Lectura ligera del JSON para previsualizar el partido (sin subir nada).
const previsualizar = (contenido) => {
  try {
    const j = JSON.parse(contenido)
    const ev = j && j.info && j.info.event
    if (!ev || !ev.id) return { valido: false, texto: "no es un dump de partido" }
    return {
      valido: true,
      id: ev.id,
      partido: `${ev.homeTeam?.name ?? "?"} vs ${ev.awayTeam?.name ?? "?"}`,
      fecha: ev.startTimestamp
        ? new Date(ev.startTimestamp * 1000).toISOString().slice(0, 10)
        : "—",
      liga: ev.tournament?.name || "—",
    }
  } catch {
    return { valido: false, texto: "JSON inválido" }
  }
}

export const SubirEstadisticas = () => {
  const [carpeta, setCarpeta] = useState("")
  const [archivos, setArchivos] = useState([])
  const [ligaSel, setLigaSel] = useState("")
  const [jornada, setJornada] = useState("")
  const [subiendo, setSubiendo] = useState(false)
  const [progreso, setProgreso] = useState("")
  const [resultados, setResultados] = useState(null)
  const [error, setError] = useState(null)
  const [parteInfo, setParteInfo] = useState(null)
  const [parteStats, setParteStats] = useState(null)
  const carpetaRef = useRef(null)
  const sueltosRef = useRef(null)
  const infoRef = useRef(null)
  const statsRef = useRef(null)
  const { data: ligasDisponibles } = useFetch("/api/leagues")

  const limpiarPartes = () => {
    setParteInfo(null)
    setParteStats(null)
    if (infoRef.current) infoRef.current.value = ""
    if (statsRef.current) statsRef.current.value = ""
  }

  const limpiar = () => {
    setCarpeta("")
    setArchivos([])
    setLigaSel("")
    setJornada("")
    setResultados(null)
    setError(null)
    setProgreso("")
    limpiarPartes()
    if (carpetaRef.current) carpetaRef.current.value = ""
    if (sueltosRef.current) sueltosRef.current.value = ""
  }

  const cargar = async (lista, origen) => {
    const jsons = lista.filter((f) => f.name.toLowerCase().endsWith(".json"))
    const ruta = jsons[0]?.webkitRelativePath || ""
    setCarpeta(origen === "carpeta" && ruta ? ruta.split("/")[0] : origen)
    setResultados(null)
    setError(null)
    if (!jsons.length) {
      setArchivos([])
      setError("La selección no contiene archivos .json")
      return
    }
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

  const seleccionarCarpeta = (e) => {
    limpiarPartes()
    return cargar(Array.from(e.target.files || []), "carpeta")
  }
  const seleccionarSueltos = (e) => {
    limpiarPartes()
    return cargar(Array.from(e.target.files || []), "archivos sueltos")
  }

  // Subida en 2 partes (extracto del celular): info.json + stats.json se
  // combinan en un único dump y se agrega como UN archivo a subir.
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

  const subir = async () => {
    if (!archivos.length || subiendo) return
    setSubiendo(true)
    setError(null)
    setResultados(null)

    // Lotes de ~6MB para no pisar el límite del body parser.
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

    const acum = { resultados: [], resumen: resumenVacio() }
    const body = (lote) => {
      const b = { files: lote.map((a) => ({ nombre: a.nombre, contenido: a.contenido })) }
      if (ligaSel) b.liga = ligaSel
      if (jornada) b.jornada = Number(jornada)
      return b
    }
    try {
      for (let i = 0; i < lotes.length; i++) {
        setProgreso(`Subiendo lote ${i + 1} de ${lotes.length}…`)
        const res = await axios.post(`${API_URL}/api/estadisticas/lote`, body(lotes[i]))
        acum.resultados.push(...res.data.resultados)
        const r = res.data.resumen
        acum.resumen.archivos += r.archivos
        acum.resumen.creados += r.creados
        acum.resumen.actualizados += r.actualizados
        acum.resumen.saltados += r.saltados
        acum.resumen.errores += r.errores
        acum.resumen.filas_insertadas += r.filas_insertadas
        setResultados({ ...acum, resultados: [...acum.resultados], resumen: { ...acum.resumen } })
      }
    } catch (err) {
      console.error("Error al subir estadísticas:", err)
      setError(err.response?.data?.message || "Error al subir las estadísticas.")
      if (acum.resultados.length) {
        setResultados({ ...acum, resultados: [...acum.resultados], resumen: { ...acum.resumen } })
      }
    } finally {
      setSubiendo(false)
      setProgreso("")
    }
  }

  const validos = archivos.filter((a) => a.vista.valido).length

  return (
    <section className="subir-estadisticas">
      <h2 className="view-title">Subir estadísticas (JSON por partido)</h2>

      <section className="card">
        <div className="card-header">Origen de los JSON</div>
        <label className="field">
          <span className="field-label">
            Carpeta con los JSON (1 archivo por partido, formato Sofascore)
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
            disabled={subiendo}
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
            disabled={subiendo}
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
            disabled={subiendo}
          />
        </label>
        <label className="field">
          <span className="field-label">…parte 2: stats.json (estadísticas)</span>
          <input
            ref={statsRef}
            className="field-input"
            type="file"
            accept=".json,application/json"
            onChange={seleccionarParte("stats")}
            disabled={subiendo}
          />
        </label>
        <ul className="explicacion">
          <li>Si el partido no existe, se crea en la base de datos con los datos del JSON.</li>
          <li>Si el partido ya tiene estadísticas, se salta (nada se pisa; subir dos veces es seguro).</li>
          <li>Si existe pero le faltan datos en la cabecera, solo se completan los vacíos.</li>
          <li>Desde el celular: sube info.json y stats.json por separado — se combinan automáticamente.</li>
        </ul>
        {carpeta && (
          <p className="tabla-status">
            Origen: {carpeta} — {archivos.length} archivo(s) .json detectado(s)
            {archivos.length !== validos ? ` (${archivos.length - validos} inválido(s))` : ""}
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-header">Asignación del lote (opcional)</div>
        <label className="field">
          <span className="field-label">Liga para todos los archivos</span>
          <select
            className="field-input"
            value={ligaSel}
            onChange={(e) => setLigaSel(e.target.value)}
            disabled={subiendo}
          >
            <option value="">Del JSON (automático)</option>
            {(ligasDisponibles || []).map((l) => (
              <option key={l.name} value={l.name}>{l.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Jornada para todos los archivos (vacío = del JSON)</span>
          <input
            className="field-input"
            type="number"
            min="1"
            value={jornada}
            onChange={(e) => setJornada(e.target.value)}
            disabled={subiendo}
          />
        </label>
        <p className="tabla-status">
          Si eliges liga/jornada aquí, se aplica a todo el lote en lugar del valor del JSON.
          Un partido existente que ya tenga esos datos nunca se modifica.
        </p>
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
                    <td>{a.vista.valido ? (ligaSel || a.vista.liga) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="actions">
        <button className="btn btn-secondary" onClick={limpiar} disabled={subiendo}>
          Limpiar
        </button>
        <button className="btn btn-primary" onClick={subir} disabled={!archivos.length || subiendo}>
          {subiendo ? "Subiendo..." : `Subir ${archivos.length || ""} archivo(s)`}
        </button>
      </div>

      {progreso && <p className="tabla-status">{progreso}</p>}
      {error && <p className="tabla-status tabla-status-error">{error}</p>}

      {resultados && (
        <section className="card">
          <div className="card-header">Resultado de la carga</div>
          <div className="result-row">
            <span className="result-label">Archivos procesados</span>
            <span className="result-value">{resultados.resumen.archivos}</span>
          </div>
          <div className="result-row">
            <span className="result-label">Partidos creados</span>
            <span className="result-value">{resultados.resumen.creados}</span>
          </div>
          <div className="result-row">
            <span className="result-label">Cabeceras completadas</span>
            <span className="result-value">{resultados.resumen.actualizados}</span>
          </div>
          <div className="result-row">
            <span className="result-label">Saltados (ya tenían stats)</span>
            <span className="result-value">{resultados.resumen.saltados}</span>
          </div>
          <div className="result-row">
            <span className="result-label">Errores</span>
            <span className="result-value">{resultados.resumen.errores}</span>
          </div>
          <div className="result-row">
            <span className="result-label">Filas de estadísticas insertadas</span>
            <span className="result-value">{resultados.resumen.filas_insertadas}</span>
          </div>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Partido</th>
                  <th>Liga</th>
                  <th>Acción</th>
                  <th>Stats</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {resultados.resultados.map((r) => (
                  <tr key={r.archivo}>
                    <td>{r.archivo}</td>
                    <td>{r.partido || "—"}</td>
                    <td>{r.liga || "—"}{r.jornada ? ` (J${r.jornada})` : ""}</td>
                    <td>
                      <span className={`resultado-chip ${CHIPS[r.accion] || "resultado-e"}`}>
                        {ETIQUETAS[r.accion] || r.accion}
                      </span>
                    </td>
                    <td className="tabla-num">{r.stats}</td>
                    <td>{r.motivo || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  )
}
