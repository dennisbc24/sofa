const numero = (valor) => (valor === null || valor === undefined ? "—" : valor)

export const TablaAnalisis2 = ({ resultados }) => {
  if (!resultados?.length) return null

  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            <th>Liga</th>
            <th>Jornada</th>
            <th>Local</th>
            <th>Visitante</th>
            <th>Dif. goles 1T</th>
            <th>Goles 1T</th>
            <th>Goles 2T</th>
            <th>Corners 1T</th>
            <th>Corners 2T</th>
            <th>Total corners</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((r, idx) => (
            <tr key={`${r.equipo_local}-${r.equipo_visitante}-${r.fecha_jornada}-${idx}`}>
              <td>{r.liga}</td>
              <td>{numero(r.fecha_jornada)}</td>
              <td>{r.equipo_local}</td>
              <td>{r.equipo_visitante}</td>
              <td>{numero(r.diferencia_goles_1t)}</td>
              <td>{numero(r.goles_total_1t)}</td>
              <td>{numero(r.goles_total_2t)}</td>
              <td>{numero(r.corners_total_1t)}</td>
              <td>{numero(r.corners_total_2t)}</td>
              <td>{numero(r.total_corners)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}