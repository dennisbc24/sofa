import { useRef, useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import useFetch from "../hooks/useFetch.jsx"

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
  const inputRef = useRef(null)
  const { data: ligasDisponibles } = useFetch("/api/leagues")

  const limpiar = () => {
    setCarpeta("")
    setArchivos([])
    setLigaSel("")
    setJornada("")
    setResultados(null)
    setError(null)
    setProgreso("")
    if (inputRef.current) inputRef.current.value = ""
  }

  const seleccionarCarpeta = async (e) => {
    const lista = Array.from(e.target.files || []).filter((f) =>
      f.name.toLowerCase().endsWith(".json")
    )
    const ruta = lista[0]?.webkitRelativePath || ""
    setCarpeta(ruta ? ruta.split("/")[0] : "")
    setResultados(null)
    setError(null)
    if (!lista.length) {
      setArchivos([])
      setError("La carpeta seleccionada no contiene archivos .json")
      return
    }
    const leidos = await Promise.all(
      lista.map(async (f) => {
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
        <div className="card-header">Carpeta de origen</div>
        <label className="field">
          <span className="field-label">
            Carpeta con los JSON (1 archivo por partido, formato Sofascore)
          </span>
          <input
            ref={inputRef}
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
        <ul className="explicacion">
          <li>Si el partido no existe, se crea en la base de datos con los datos del JSON.</li>
          <li>Si el partido ya tiene estadísticas, se salta (nada se pisa; subir dos veces es seguro).</li>
          <li>Si existe pero le faltan datos en la cabecera, solo se completan los vacíos.</li>
        </ul>
        {carpeta && (
          <p className="tabla-status">
            Carpeta: {carpeta} — {archivos.length} archivo(s) .json detectado(s)
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
