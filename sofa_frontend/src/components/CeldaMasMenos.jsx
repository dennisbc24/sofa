// ---------------------------------------------------------------------------
// Celda "Mas/Menos" con acierto en color: verde el lado que se cumplio
// (mas / menos) y rojo tachado el que fallo. Si el real cae EXACTO en el
// umbral, ambos lados quedan en rojo (ninguno de los dos se cumplio).
// Solo tiene color cuando hay datos reales del partido (historial o
// proyeccion 2T de un partido ya cargado en la base).
// ---------------------------------------------------------------------------
export const CeldaMasMenos = ({ mm, real }) => {
  if (!mm || mm.n == null) return <td className="tabla-num">—</td>
  const total = real && real.l != null && real.v != null ? real.l + real.v : null
  const masAcierto = total == null ? null : total > mm.n
  const menosAcierto = total == null ? null : total < mm.n
  const clase = (ok) => (ok === null ? "" : ok ? "mm-acierto" : "mm-fallo")
  return (
    <td className="tabla-num">
      <span className={clase(masAcierto)}>+{mm.n} {mm.mas}%</span>
      {" · "}
      <span className={clase(menosAcierto)}>-{mm.n} {mm.menos}%</span>
    </td>
  )
}
