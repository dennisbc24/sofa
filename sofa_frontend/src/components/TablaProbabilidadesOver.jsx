const numero = (valor) => (valor === null || valor === undefined ? "—" : valor)

export const TablaProbabilidadesOver = ({ resultados, etiqueta = "Valor" }) => {
  if (!resultados?.length) return null

  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            <th>{etiqueta}</th>
            <th>Más de</th>
            <th>Menos de</th>
            <th>Partidos</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((r) => (
            <tr key={r.valor}>
              <td>{numero(r.valor)}</td>
              <td>{numero(r.masDe)}%</td>
              <td>{numero(r.menosDe)}%</td>
              <td>{numero(r.partidos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}