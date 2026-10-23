import { useMemo, useState } from "react"
import useFetch from "../hooks/useFetch.jsx"
import { Desplegable } from "./Desplegable.jsx"
import { formatearFecha } from "../utils.js"

const formatearPartido = (p) =>
  `${formatearFecha(p.fecha_partido)} · ${p.equipo_local ?? "?"} vs ${p.equipo_visitante ?? "?"}${p.fecha_jornada ? ` (J${p.fecha_jornada})` : ""}`

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
  const jugadores = useMemo(() => detalle?.jugadores || [], [detalle])
  const golesDetalle = useMemo(() => detalle?.goles || [], [detalle])
  const tarjetas = useMemo(() => detalle?.tarjetas || [], [detalle])
  const cambiosDetalle = useMemo(() => detalle?.cambios || [], [detalle])
  const remates = useMemo(() => detalle?.remates || [], [detalle])
  const descuento = useMemo(() => detalle?.descuento || null, [detalle])
  const periodos = useMemo(() => [...new Set(estadisticas.map((s) => s.periodo))], [estadisticas])
  const statsFiltradas = useMemo(
    () => estadisticas.filter((s) => s.periodo === periodo),
    [estadisticas, periodo]
  )
  const grupos = useMemo(() => [...new Set(statsFiltradas.map((s) => s.grupo))], [statsFiltradas])

  const golesJugador = useMemo(() => jugadores.filter((j) => j.goles && j.goles > 0), [jugadores])
  const asistencias = useMemo(() => jugadores.filter((j) => j.asistencias && j.asistencias > 0), [jugadores])
  const titularesNoCompletos = useMemo(() => jugadores.filter((j) => j.titular && j.jugo && (j.minutos || 0) < 90), [jugadores])

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
          <div className="result-row">
            <span className="result-label">Fecha</span>
            <span className="result-value">{formatearFecha(partidoSeleccionado.fecha_partido)}</span>
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

      {partidoId && (golesDetalle.length > 0 || tarjetas.length > 0 || cambiosDetalle.length > 0 || remates.length > 0) && (
        <section className="card">
          <div className="card-header">Incidencias del partido</div>

          {golesDetalle.length > 0 && (
            <>
              <div className="card-header">⚽ Goles</div>
              <div className="tabla-scroll">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Minuto</th>
                      <th>Equipo</th>
                      <th>Jugador</th>
                      <th>Asistente</th>
                      <th>Marcador</th>
                      <th>Tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {golesDetalle.map((g) => (
                      <tr key={g.minuto + g.jugador_id}>
                        <td className="tabla-num">{g.minuto_texto}{g.minuto_extra ? "+" + g.minuto_extra : ""}'</td>
                        <td>{g.equipo === "home" ? partidoSeleccionado?.equipo_local : partidoSeleccionado?.equipo_visitante}</td>
                        <td>{g.jugador}</td>
                        <td>{g.asistente || "—"}</td>
                        <td className="tabla-num">{g.marcador_h} - {g.marcador_a}</td>
                        <td>{g.tipo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tarjetas.length > 0 && (
            <>
              <div className="card-header">🟨🟥 Tarjetas</div>
              <div className="tabla-scroll">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Minuto</th>
                      <th>Equipo</th>
                      <th>Jugador</th>
                      <th>Tarjeta</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tarjetas.map((t) => (
                      <tr key={t.minuto + t.jugador_id}>
                        <td className="tabla-num">{t.minuto_texto}{t.minuto_extra ? "+" + t.minuto_extra : ""}'</td>
                        <td>{t.equipo === "home" ? partidoSeleccionado?.equipo_local : partidoSeleccionado?.equipo_visitante}</td>
                        <td>{t.jugador}</td>
                        <td className={`tarjeta-${t.tarjeta}`}>{t.tarjeta === "yellow" ? "🟨 Amarilla" : "🟥 Roja"}</td>
                        <td>{t.motivo || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {cambiosDetalle.length > 0 && (
            <>
              <div className="card-header">🔄 Cambios</div>
              <div className="tabla-scroll">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Minuto</th>
                      <th>Equipo</th>
                      <th>Entra</th>
                      <th>Sale</th>
                      {cambiosDetalle.some((c) => c.lesion) && <th>Lesión</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {cambiosDetalle.map((c) => (
                      <tr key={c.minuto + c.entra_id + c.sale_id}>
                        <td className="tabla-num">{c.minuto_texto}{c.minuto_extra ? "+" + c.minuto_extra : ""}'</td>
                        <td>{c.equipo === "home" ? partidoSeleccionado?.equipo_local : partidoSeleccionado?.equipo_visitante}</td>
                        <td>{c.entra}</td>
                        <td>{c.sale}</td>
                        {cambiosDetalle.some((c2) => c2.lesion) && <td>{c.lesion ? "⚠️" : "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {remates.length > 0 && (
            <>
              <div className="card-header">🎯 Remates ({remates.length})</div>
              <div className="tabla-scroll">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Minuto</th>
                      <th>Equipo</th>
                      <th>Jugador</th>
                      <th>Resultado</th>
                      <th>xG</th>
                      <th>Ubicación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remates.map((r) => (
                      <tr key={r.minuto + r.jugador_id}>
                        <td className="tabla-num">{r.minuto_texto}{r.minuto_extra ? "+" + r.minuto_extra : ""}'</td>
                        <td>{r.equipo === "home" ? partidoSeleccionado?.equipo_local : partidoSeleccionado?.equipo_visitante}</td>
                        <td>{r.jugador}</td>
                        <td className={`resultado-${r.resultado}`}>{r.resultado}</td>
                        <td className="tabla-num">{r.xg != null ? Number(r.xg).toFixed(2) : "—"}</td>
                        <td>{r.ubicacion_arco || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {descuento && (
            <>
              <div className="result-row">
                <span className="result-label">Descuento</span>
                <span className="result-value">
                  1T: +{descuento.descuento_1t}' · 2T: +{descuento.descuento_2t}'
                </span>
              </div>
            </>
          )}
        </section>
      )}

      {partidoId && jugadores.length > 0 && (
        <section className="card">
          <div className="card-header">Jugadores</div>
          <div className="result-row">
            <span className="result-label">Goles por jugador</span>
            <span className="result-value">
              {golesJugador.length > 0
                ? golesJugador.map((g) => `${g.nombre} (${g.goles})`).join(" · ")
                : "—"}
            </span>
          </div>
          <div className="result-row">
            <span className="result-label">Asistencias por jugador</span>
            <span className="result-value">
              {asistencias.length > 0
                ? asistencias.map((a) => `${a.nombre} (${a.asistencias})`).join(" · ")
                : "—"}
            </span>
          </div>
          <div className="result-row">
            <span className="result-label">Titulares sustituidos</span>
            <span className="result-value">
              {titularesNoCompletos.length > 0
                ? titularesNoCompletos.map((t) => `${t.nombre} (${t.minutos}')`).join(" · ")
                : "—"}
            </span>
          </div>
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
