import { useMemo, useState } from "react"
import useFetch from "../hooks/useFetch.jsx"
import { Desplegable } from "./Desplegable.jsx"

const formatearPartido = (p) =>
  `${p.equipo_local ?? "?"} vs ${p.equipo_visitante ?? "?"}${p.fecha_jornada ? ` (J${p.fecha_jornada})` : ""}`

export const StatsPartido = () => {
  const [liga, setLiga] = useState(null)
  const [busqueda, setBusqueda] = useState("")
  const [partidoId, setPartidoId] = useState(null)
  const [periodo, setPeriodo] = useState("ALL")

  const { data: partidos, loading: loadingPartidos, error: errorPartidos } = useFetch(
    liga ? `/api/partidos/${encodeURIComponent(liga)}` : null
  )
  const { data: detalle, loading: loadingDetalle, error: errorDetalle } = useFetch(
    partidoId ? `/api/partidos/detalle/${encodeURIComponent(partidoId)}` : null
  )

  const handleLigaChange = (e) => {
    const nuevaLiga = e.target.value
    setLiga(nuevaLiga)
    setBusqueda("")
    setPartidoId(null)
    setPeriodo("ALL")
  }

  const partidosFiltrados = useMemo(() => {
    if (!partidos) return []
    if (!busqueda) return partidos
    const q = busqueda.toLowerCase()
    return partidos.filter(
      (p) =>
        p.equipo_local?.toLowerCase().includes(q) ||
        p.equipo_visitante?.toLowerCase().includes(q) ||
        String(p.fecha_jornada ?? "").includes(q)
    )
  }, [partidos, busqueda])

  const partidoSeleccionado = useMemo(
    () => detalle?.partido ?? partidos?.find((p) => String(p.id) === String(partidoId)) ?? null,
    [detalle, partidos, partidoId]
  )

  const estadisticas = useMemo(() => detalle?.estadisticas || [], [detalle])
  const periodos = useMemo(() => [...new Set(estadisticas.map((s) => s.periodo))], [estadisticas])
  const statsFiltradas = useMemo(
    () => estadisticas.filter((s) => s.periodo === periodo),
    [estadisticas, periodo]
  )
  const grupos = useMemo(() => [...new Set(statsFiltradas.map((s) => s.grupo))], [statsFiltradas])

  return (
    <section>
      <h2 className="view-title">Stats de partido</h2>

      <Desplegable onChange={handleLigaChange} />

      {!liga && (
        <p className="tabla-status">Primero selecciona una liga para buscar el partido.</p>
      )}

      {liga && (
        <section className="card">
          <div className="card-header">Liga: {liga}</div>
          {loadingPartidos && <p className="tabla-status">Cargando partidos de {liga}...</p>}
          {errorPartidos && (
            <p className="tabla-status tabla-status-error">Error al cargar los partidos de {liga}.</p>
          )}
          {!loadingPartidos && !errorPartidos && (
            <>
              <label className="field">
                <span className="field-label">Buscar partido (equipo o jornada)</span>
                <input
                  className="field-input"
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Ej: Madrid, Betis, 10..."
                />
              </label>
              <label className="field">
                <span className="field-label">Partido ({partidosFiltrados.length})</span>
                <select
                  className="field-input"
                  value={partidoId ?? ""}
                  onChange={(e) => setPartidoId(e.target.value || null)}
                >
                  <option value="">— Selecciona un partido —</option>
                  {partidosFiltrados.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatearPartido(p)} — {p.goles_local ?? "—"}:{p.goles_visitante ?? "—"}
                    </option>
                  ))}
                </select>
              </label>
              {!partidos?.length && <p className="tabla-status">Sin partidos para {liga}.</p>}
              {partidos?.length > 0 && partidosFiltrados.length === 0 && (
                <p className="tabla-status">Sin partidos que coincidan con la búsqueda.</p>
              )}
            </>
          )}
        </section>
      )}

      {partidoId && partidoSeleccionado && (
        <section className="card">
          <div className="card-header">
            {partidoSeleccionado.equipo_local} {partidoSeleccionado.goles_local ?? "—"} -{" "}
            {partidoSeleccionado.goles_visitante ?? "—"} {partidoSeleccionado.equipo_visitante}
          </div>
          <div className="result-row">
            <span className="result-label">Liga</span>
            <span className="result-value">{partidoSeleccionado.liga || "—"}</span>
          </div>
          <div className="result-row">
            <span className="result-label">Jornada</span>
            <span className="result-value">{partidoSeleccionado.fecha_jornada ?? "—"}</span>
          </div>
          {(partidoSeleccionado.goles_local_1T !== undefined ||
            partidoSeleccionado.goles_visitante_1T !== undefined) && (
            <div className="result-row">
              <span className="result-label">Resultado 1T</span>
              <span className="result-value">
                {partidoSeleccionado.goles_local_1T ?? "—"} -{" "}
                {partidoSeleccionado.goles_visitante_1T ?? "—"}
              </span>
            </div>
          )}
        </section>
      )}

      {partidoId && (
        <section className="card">
          <div className="card-header">Estadísticas</div>
          {loadingDetalle && <p className="tabla-status">Cargando stats del partido...</p>}
          {errorDetalle && (
            <p className="tabla-status tabla-status-error">Error al cargar las stats del partido.</p>
          )}
          {!loadingDetalle && !errorDetalle && detalle && (
            <>
              {periodos.length > 0 && (
                <div className="tabs">
                  {periodos.map((p) => (
                    <button
                      key={p}
                      className={`tab ${periodo === p ? "tab-active" : ""}`}
                      onClick={() => setPeriodo(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
              {statsFiltradas.length === 0 && (
                <p className="tabla-status">Sin stats para este partido en {periodo}.</p>
              )}
              {grupos.map((grupo) => (
                <div key={grupo}>
                  <div className="card-header">{grupo || "General"}</div>
                  <div className="tabla-scroll">
                    <table className="tabla">
                      <thead>
                        <tr>
                          <th>Stat</th>
                          <th>{partidoSeleccionado?.equipo_local || "Local"}</th>
                          <th>{partidoSeleccionado?.equipo_visitante || "Visita"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statsFiltradas
                          .filter((s) => s.grupo === grupo)
                          .map((s) => (
                            <tr key={s.id ?? `${s.grupo}-${s.nombre}-${s.periodo}`}>
                              <td>{s.nombre}</td>
                              <td className="tabla-num">{s.valor_local ?? "—"}</td>
                              <td className="tabla-num">{s.valor_visitante ?? "—"}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
          {!loadingDetalle && !errorDetalle && !detalle && (
            <p className="tabla-status">Selecciona un partido para ver sus stats.</p>
          )}
        </section>
      )}
    </section>
  )
}
