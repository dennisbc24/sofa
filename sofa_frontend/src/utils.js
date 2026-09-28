export const formatearFechaHora = (fecha) => {
  if (!fecha) return "—"
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("es")
}

export const formatearFecha = (fecha) => {
  if (!fecha) return "—"
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("es")
}
