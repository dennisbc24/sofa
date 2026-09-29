// ---------------------------------------------------------------------------
// EXPERIMENTO 2 — DAVIDSON (EXCLUSIVO DE INVESTIGACIÓN, NO PRODUCCIÓN).
//
// Modelo (Davidson, 1998, "Modeling Dependent Pairs of Home and Away
// Batting Statistics", y su uso estándar para marcadores de fútbol):
//
//   p(x,y) = ν^(x=y) · Pois(x; λh) · Pois(y; λa) / Z
//   Z = Σ_{i,j} ν^(i=j) · Pois(i; λh) · Pois(j; λa)      (renormalizar)
//
// Es decir: TODA la diagonal de empates (0-0, 1-1, 2-2, 3-3, …) se multiplica
// por un factor ν > 0 antes de renormalizar; las celdas de victoria (x≠y) no
// se tocan directamente (sólo se ven afectadas por la normalización).
//
//   ν > 1 → todos los empates suben      ν < 1 → todos los empates bajan
//   ν = 1 → exactamente el modelo base A (Poisson independiente)
//
// Diferencia clave con Dixon-Coles (Experimento 1): DC movía 0-0 y 1-1 juntos
// con pesos que además trasladaban masa desde 1-0/0-1; Davidson mueve TODOS
// los empates en la misma dirección relativa (masa de empate, CASO C de
// fase3_5), sin redistribución hacia victorias locales/visitantes.
//
// Estimación: máxima verosimilitud CONDICIONAL con los λ de A congelados,
// sobre TODOS los partidos del fit (los empates aportan log ν):
//   max_ν  Σ_i [ 1{empate_i} · log ν − log(A_i + ν·B_i) ]
//   con A_i = Σ_{x≠y} Pois(x)Pois(y),  B_i = Σ_{x=y} Pois(x)Pois(y)
// (los pesos Pois constantes del numerador se omiten: no dependen de ν).
// Concavo en ν>0 → grid en log-espacio 4001 puntos + refinamiento 4001,
// determinista. Rango: ν ∈ (0.05, 20]; sólo restricción real ν>0.
// Sin decaimiento temporal ξ (pesos uniformes, coherente con V1/A).
// IMPORTANTE: ll(ν̂) − ll(1) es evidencia SÓLO in-sample (el MLE ajustó el
// fit). La decisión DAV-A vs A se evalúa EXCLUSIVAMENTE fuera de muestra.
// ---------------------------------------------------------------------------
const { aPorcentajes } = require("../services/prediccion/modelo_poisson");

const K = 15; // idéntico a K_MAX de modelo_poisson.js
const EPS = 1e-9;
const NU_LO = 0.05;
const NU_HI = 20;

// copia de modelo_poisson.poissonPmf
function poisPmf(k, lambda) {
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda + EPS) - Math.log(i);
  return Math.exp(logP);
}

// Matriz conjunta normalizada con ν en la diagonal (rejilla y orden de
// acumulación idénticos a probsDesdeLambdas → con nu=1 el float es bit a bit
// igual al modelo base).
function matrizNormD(lamH, lamA, nu) {
  const pH = [];
  const pA = [];
  for (let k = 0; k <= K; k++) {
    pH.push(poisPmf(k, lamH));
    pA.push(poisPmf(k, lamA));
  }
  const mat = [];
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i <= K; i++) {
    mat.push(new Array(K + 1));
    for (let j = 0; j <= K; j++) {
      const p = pH[i] * pA[j] * (i === j ? nu : 1);
      mat[i][j] = p;
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  }
  const total = home + draw + away;
  for (let i = 0; i <= K; i++) for (let j = 0; j <= K; j++) mat[i][j] /= total;
  return { home: home / total, draw: draw / total, away: away / total, mat, total };
}

// Probabilidades 1X2 redondeadas igual que producción (1 decimal, suma 100.0)
function probsDavidson(lamH, lamA, nu) {
  const m = matrizNormD(lamH, lamA, nu);
  return aPorcentajes(m.home, m.draw, m.away, 1);
}

// MLE de ν sobre el fit completo: max_ν Σ [1{empate}·log ν − log(A + ν·B)].
// partidos: [{ lh, la, draw }] (draw = x===y en el marcador real del fit).
function ajustarNu(partidos) {
  if (!partidos.length) return { nu: 1, llNu: 0, ll1: 0, rango: { lo: NU_LO, hi: NU_HI }, enBorde: false, nDraws: 0 };
  const terms = partidos.map((p) => {
    const pH = [];
    const pA = [];
    for (let k = 0; k <= K; k++) { pH.push(poisPmf(k, p.lh)); pA.push(poisPmf(k, p.la)); }
    let A = 0;
    let B = 0;
    for (let i = 0; i <= K; i++) {
      for (let j = 0; j <= K; j++) {
        const w = pH[i] * pA[j];
        if (i === j) B += w;
        else A += w;
      }
    }
    return { A, B, draw: p.draw };
  });
  const nDraws = terms.reduce((s, t) => s + (t.draw ? 1 : 0), 0);
  const ll = (nu) => {
    let s = 0;
    for (const t of terms) {
      if (t.draw) s += Math.log(nu);
      s -= Math.log(t.A + nu * t.B);
    }
    return s;
  };
  const N = 4001;
  const lLo = Math.log(NU_LO);
  const lHi = Math.log(NU_HI);
  let mejor = 1;
  let llMejor = ll(1);
  const paso = (lHi - lLo) / (N - 1);
  for (let i = 0; i < N; i++) {
    const nu = Math.exp(lLo + i * paso);
    const v = ll(nu);
    if (v > llMejor) { llMejor = v; mejor = nu; }
  }
  const l0 = Math.log(mejor);
  const la = Math.max(lLo, l0 - paso);
  const lb = Math.min(lHi, l0 + paso);
  const paso2 = (lb - la) / (N - 1);
  for (let i = 0; i < N; i++) {
    const nu = Math.exp(la + i * paso2);
    const v = ll(nu);
    if (v > llMejor) { llMejor = v; mejor = nu; }
  }
  const ll1 = ll(1);
  if (ll1 >= llMejor) return { nu: 1, llNu: ll1, ll1, rango: { lo: NU_LO, hi: NU_HI }, enBorde: false, nDraws };
  const enBorde = mejor <= NU_LO * 1.001 || mejor >= NU_HI * 0.999;
  return { nu: mejor, llNu: llMejor, ll1, rango: { lo: NU_LO, hi: NU_HI }, enBorde, nDraws };
}

module.exports = { K, poisPmf, matrizNormD, probsDavidson, ajustarNu };
