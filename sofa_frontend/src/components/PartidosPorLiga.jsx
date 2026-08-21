import useFetch from "../hooks/useFetch.jsx"

const formatearFechaHora = (fecha) => {
  if (!fecha) return "—"
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("es")
}

export const PartidosPorLiga = ({ liga }) => {
  const { data: partidos, loading, error } = useFetch(
    liga ? `/api/partidos/ultimos/${encodeURIComponent(liga)}` : null
  )

  if (!liga) return null
  if (loading) return <p className="tabla-status">Cargando partidos de {liga}...</p>
  if (error) return <p className="tabla-status tabla-status-error">Error al cargar los partidos de {liga}.</p>
  if (!partidos?.length) return <p className="tabla-status">Sin partidos para {liga}.</p>

  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            <th>Jornada</th>
            <th className="tabla-equipos">Partido</th>
            <th>Resultado</th>
            <th>Agregado</th>
          </tr>
        </thead>
        <tbody>
          {partidos.map((p) => (
            <tr key={p.id}>
              <td>{p.fecha_jornada ?? "—"}</td>
              <td className="tabla-equipos">
                <span className="tabla-equipo">{p.equipo_local}</span>
                <span className="tabla-goles">
                  {p.goles_local} - {p.goles_visitante}
                </span>
                <span className="tabla-equipo">{p.equipo_visitante}</span>
              </td>
              <td>{formatearFechaHora(p.scrapeado_en)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}