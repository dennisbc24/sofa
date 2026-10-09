// Mercados derivados en el frontend con Poisson sobre goles predichas
// (usado por la proyección 2T: ambos marcan y cantidad de goles).
const pmf = (k, l) => {
  let f = 1
  for (let i = 2; i <= k; i++) f *= i
  return (Math.exp(-l) * l ** k) / f
}
const pct1 = (x) => Math.round(x * 1000) / 10

export const ambosMarcan = (lh, la) => {
  if (lh == null || la == null) return null
  const si = (1 - pmf(0, lh)) * (1 - pmf(0, la))
  return { si: pct1(si), no: pct1(1 - si) }
}

export const overLines = (l) => {
  if (l == null) return null
  const p = (max) => {
    let s = 0
    for (let i = 0; i <= max; i++) s += pmf(i, l)
    return s
  }
  return {
    esperados: Math.round(l * 100) / 100,
    o05: pct1(1 - p(0)),
    o15: pct1(1 - p(1)),
    o25: pct1(1 - p(2)),
  }
}
