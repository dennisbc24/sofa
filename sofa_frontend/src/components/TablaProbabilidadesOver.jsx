const numero = (valor) => (valor === null || valor === undefined ? "—" : valor)

const linea = (valor) =>
  valor === null || valor === undefined ? "—" : `${Number(valor)}`

export const TablaProbabilidadesOver = ({ resultados, etiqueta = "Valor" }) => {
  if (!resultados?.length) return null

  const tieneDetalle = resultados[0]?.partidosMasDe !== undefined

  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            <th>{etiqueta} (línea)</th>
            <th>Más de</th>
            {tieneDetalle && <th>Partidos (Más de)</th>}
            <th>Menos de</th>
            {tieneDetalle && <th>Partidos (Menos de)</th>}
            <th>{tieneDetalle ? "Total" : "Partidos"}</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((r) => {
            const masDe = r.masDe
            const menosDe = r.menosDe !== undefined ? r.menosDe : 100 - masDe
            const partidosMasDe = r.partidosMasDe !== undefined ? r.partidosMasDe : r.partidos
            const partidosMenosDe = r.partidosMenosDe
            const total = r.partidosTotal ?? r.total ?? r.partidos
            return (
              <tr key={r.valor}>
                <td>{linea(r.valor)}</td>
                <td>{numero(masDe)}%</td>
                {tieneDetalle && <td>{numero(partidosMasDe)}</td>}
                <td>{numero(menosDe)}%</td>
                {tieneDetalle && <td>{numero(partidosMenosDe)}</td>}
                <td>{numero(total)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}