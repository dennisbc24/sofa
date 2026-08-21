const numero = (valor) => (valor === null || valor === undefined ? "—" : valor)

const linea = (valor) =>
  valor === null || valor === undefined ? "—" : `${Number(valor)}`

export const TablaProbabilidadesOver = ({ resultados, etiqueta = "Valor" }) => {
  if (!resultados?.length) return null

  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            <th>{etiqueta} (línea)</th>
            <th>Más de</th>
            <th>Menos de</th>
            <th>Partidos</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((r) => (
            <tr key={r.valor}>
              <td>{linea(r.valor)}</td>
              <td>{numero(r.masDe)}%</td>
              <td>{numero(100 - r.masDe)}%</td>
              <td>{numero(r.partidos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}