export const posicionTramos = (e, ancho = 360, alto = 330) => {
  const r = e.currentTarget.getBoundingClientRect()
  const x = Math.max(8, Math.min(r.left + r.width / 2 - ancho / 2, window.innerWidth - ancho - 8))
  const y = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - alto - 8))
  return { x, y }
}

export const fmtTramo = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(2))

export const pctTramo = (v) =>
  v === null || v === undefined ? "—" : `${Math.round(Number(v) * 100)}%`
