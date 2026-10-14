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
    o35: pct1(1 - p(3)),
  }
}

// Líneas over dinámicas alrededor de la esperada (para corners y remates,
// cuyos totales varían mucho por liga): [{ l: "20.5", p: 52.3 }, ...].
export const overDinamicas = (l) => {
  if (l == null) return []
  const m = Math.round(l)
  return [m - 1.5, m - 0.5, m + 0.5]
    .filter((x) => x >= 0.5)
    .map((x) => {
      let s = 0
      for (let i = 0; i <= Math.floor(x); i++) s += pmf(i, l)
      return { l: x.toFixed(1), p: pct1(1 - s) }
    })
}

export const textoOver = (over) =>
  (over || []).map((o) => `${o.l} ${o.p}%`).join(" · ") || "—"

// Más/menos del total redondeado predicho: N = round(λ), P(más)=P(X>N),
// P(menos)=P(X<N), P(exacto)=P(X=N). El backend ya lo trae como `mm`.
export const masMenos = (l) => {
  if (l == null) return null
  const n = Math.round(l)
  const pLE = (max) => {
    let s = 0
    for (let i = 0; i <= max; i++) s += pmf(i, l)
    return s
  }
  return {
    n,
    mas: pct1(1 - pLE(n)),
    menos: pct1(n > 0 ? pLE(n - 1) : 0),
    exacto: pct1(pmf(n, l)),
  }
}

export const textoMasMenos = (mm) =>
  mm == null || mm.n == null ? "—" : `+${mm.n} ${mm.mas}% · -${mm.n} ${mm.menos}%`

// Probabilidad de PERDER por equipo derivada del 1X2 en % (local pierde =
// P(gana visita) y viceversa). Lee `noPierde` si existe y si no lo deriva de
// `probabilities` o de `resultado1x2.probabilidades` (proyección 2T).
export const noPierdeDe = (f) => {
  if (!f) return null
  if (f.noPierde?.local && f.noPierde?.visita) return f.noPierde
  const p = f.probabilities || f.resultado1x2?.probabilidades
  if (!p || p.home == null || p.away == null) return null
  const r1 = (v) => Math.round(v * 10) / 10
  return {
    local: { pierde: r1(p.away), noPierde: r1(100 - p.away) },
    visita: { pierde: r1(p.home), noPierde: r1(100 - p.home) },
  }
}
