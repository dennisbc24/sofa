const numero = (v) => (v === null || v === undefined ? "—" : v)

export const TablaAnalisisEquipo1T = ({ resultados }) => {
  if (!resultados?.length) return null

  return (
    <div className="tabla-scroll">
      <table className="tabla tabla-analisis-equipo1t">
        <thead>
          <tr>
            <th rowSpan={2}>Liga</th>
            <th rowSpan={2}>Jornada</th>
            <th rowSpan={2}>Local</th>
            <th rowSpan={2}>Visitante</th>
            <th colSpan={3}>Goles</th>
            <th colSpan={3}>Remates</th>
            <th colSpan={3}>Corners</th>
          </tr>
          <tr>
            <th>1T (L-V / Total)</th>
            <th>2T (L-V / Total)</th>
            <th>Total</th>
            <th>Local 1T</th>
            <th>Visita 1T</th>
            <th>Total 1T</th>
            <th>Local 1T</th>
            <th>Visita 1T</th>
            <th>Total 1T</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((r) => (
            <tr key={r.id}>
              <td>{r.liga}</td>
              <td>{numero(r.fecha_jornada)}</td>
              <td>{r.equipo_local}</td>
              <td>{r.equipo_visitante}</td>
              {/* Goles 1T: L-V / Total */}
              <td>{numero(r.goles_local_1t)} - {numero(r.goles_visitante_1t)} <span className="tabla-muted">({numero(r.goles_total_1t)})</span></td>
              <td>{numero(r.goles_local_2t)} - {numero(r.goles_visitante_2t)} <span className="tabla-muted">({numero(r.goles_total_2t)})</span></td>
              <td>{numero(r.goles_total)}</td>
              {/* Remates 1T/2T - mostraremos 1T detallado y 2T como tooltip o segunda fila? Para simplificar: 1T en columnas, 2T en title */}
              <td title={`2T: ${numero(r.remates_local_2t)} - ${numero(r.remates_visitante_2t)} (Total ${numero(r.remates_total_2t)})`}>{numero(r.remates_local_1t)}</td>
              <td title={`2T: ${numero(r.remates_local_2t)} - ${numero(r.remates_visitante_2t)} (Total ${numero(r.remates_total_2t)})`}>{numero(r.remates_visitante_1t)}</td>
              <td title={`2T total: ${numero(r.remates_total_2t)}`}>{numero(r.remates_total_1t)}</td>
              <td title={`2T: ${numero(r.corners_local_2t)} - ${numero(r.corners_visitante_2t)} (Total ${numero(r.corners_total_2t)})`}>{numero(r.corners_local_1t)}</td>
              <td title={`2T: ${numero(r.corners_local_2t)} - ${numero(r.corners_visitante_2t)} (Total ${numero(r.corners_total_2t)})`}>{numero(r.corners_visitante_1t)}</td>
              <td title={`2T total: ${numero(r.corners_total_2t)}`}>{numero(r.corners_total_1t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tabla-status">Hover en remates/corners para ver datos 2T. Ordenado por corners 1T ↓</p>
    </div>
  )
}

// Versión expandida opcional con todas las columnas separadas
export const TablaAnalisisEquipo1TExpandida = ({ resultados }) => {
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
            <th>Goles L 1T</th>
            <th>Goles V 1T</th>
            <th>Total 1T</th>
            <th>Goles L 2T</th>
            <th>Goles V 2T</th>
            <th>Total 2T</th>
            <th>Rem L 1T</th>
            <th>Rem V 1T</th>
            <th>Rem Total 1T</th>
            <th>Rem L 2T</th>
            <th>Rem V 2T</th>
            <th>Rem Total 2T</th>
            <th>Corn L 1T</th>
            <th>Corn V 1T</th>
            <th>Corn Total 1T</th>
            <th>Corn L 2T</th>
            <th>Corn V 2T</th>
            <th>Corn Total 2T</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((r) => (
            <tr key={r.id}>
              <td>{r.liga}</td>
              <td>{numero(r.fecha_jornada)}</td>
              <td>{r.equipo_local}</td>
              <td>{r.equipo_visitante}</td>
              <td>{numero(r.goles_local_1t)}</td>
              <td>{numero(r.goles_visitante_1t)}</td>
              <td>{numero(r.goles_total_1t)}</td>
              <td>{numero(r.goles_local_2t)}</td>
              <td>{numero(r.goles_visitante_2t)}</td>
              <td>{numero(r.goles_total_2t)}</td>
              <td>{numero(r.remates_local_1t)}</td>
              <td>{numero(r.remates_visitante_1t)}</td>
              <td>{numero(r.remates_total_1t)}</td>
              <td>{numero(r.remates_local_2t)}</td>
              <td>{numero(r.remates_visitante_2t)}</td>
              <td>{numero(r.remates_total_2t)}</td>
              <td>{numero(r.corners_local_1t)}</td>
              <td>{numero(r.corners_visitante_1t)}</td>
              <td>{numero(r.corners_total_1t)}</td>
              <td>{numero(r.corners_local_2t)}</td>
              <td>{numero(r.corners_visitante_2t)}</td>
              <td>{numero(r.corners_total_2t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
