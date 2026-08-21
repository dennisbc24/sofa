const numero = (valor) => (valor === null || valor === undefined ? "—" : valor)

export const TablaAnalisis3 = ({ resultados, equipo }) => {
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
            <th>Goles local 1T</th>
            <th>Goles visitante 1T</th>
            <th>Goles local 2T</th>
            <th>Goles visitante 2T</th>
            <th>Goles local</th>
            <th>Goles visitante</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((r, idx) => {
            const cls = (nombre) => (!equipo ? "" : r[nombre] === equipo ? "tabla-equipo" : "tabla-rival")
            return (
              <tr key={`${r.equipo_local}-${r.equipo_visitante}-${r.fecha_jornada}-${idx}`}>
                <td>{r.liga}</td>
                <td>{numero(r.fecha_jornada)}</td>
                <td className={cls("equipo_local")}>{r.equipo_local}</td>
                <td className={cls("equipo_visitante")}>{r.equipo_visitante}</td>
                <td className={cls("equipo_local")}>{numero(r.goles_local_1t)}</td>
                <td className={cls("equipo_visitante")}>{numero(r.goles_visitante_1t)}</td>
                <td className={cls("equipo_local")}>{numero(r.goles_local_2t)}</td>
                <td className={cls("equipo_visitante")}>{numero(r.goles_visitante_2t)}</td>
                <td className={cls("equipo_local")}>{numero(r.goles_local)}</td>
                <td className={cls("equipo_visitante")}>{numero(r.goles_visitante)}</td>
                <td>{numero(r.goles_total)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}