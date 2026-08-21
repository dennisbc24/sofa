const numero = (valor) => (valor === null || valor === undefined ? "—" : valor)

export const TablaRoja1t = ({ resultados }) => {
  if (!resultados?.length) return null

  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            <th>Liga</th>
            <th>Fecha</th>
            <th>Local</th>
            <th>Visitante</th>
            <th>Goles 1T</th>
            <th>Goles 2T</th>
            <th>Corners 1T</th>
            <th>Corners 2T</th>
            <th>Total corners</th>
            <th>Remates 1T</th>
            <th>Remates 2T</th>
            <th>Total remates</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((r) => (
            <tr key={r.id}>
              <td>{r.liga}</td>
              <td>{numero(r.fecha_jornada)}</td>
              <td>{r.equipo_local}</td>
              <td>{r.equipo_visitante}</td>
              <td>{numero(r.goles_total_1t)}</td>
              <td>{numero(r.goles_total_2t)}</td>
              <td>{numero(r.corners_total_1t)}</td>
              <td>{numero(r.corners_total_2t)}</td>
              <td>{numero(r.total_corners)}</td>
              <td>{numero(r.remates_total_1t)}</td>
              <td>{numero(r.remates_total_2t)}</td>
              <td>{numero(r.total_remates)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}