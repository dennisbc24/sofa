// ---------------------------------------------------------------------------
// EXPERIMENTO 1 — Dixon-Coles (EXCLUSIVO DE INVESTIGACIÓN, NO PRODUCCIÓN).
//
// Fórmula (Dixon & Coles 1997, "Modelling Association Football Scores and
// Inefficiencies in the Football Betting Market", JRSS-C 46:265-280).
// Verificada en 3 fuentes independientes que coinciden:
//  - Michels/Ötting/Karis, arXiv:2307.02139, eq. de τ (reescritura del paper)
//  - R-bloggers (tau_dc) y github.com/goclfc/football-predictor (dixon_coles)
//  - github.com/callumfm/dixon-coles (dixon_coles_tau)
//
//   μ(x,y) = τ(x, y; λh, λa, ρ) · Pois(x; λh) · Pois(y; λa)   [renormalizar]
//
//   τ(0,0) = 1 − λh·λa·ρ
//   τ(0,1) = 1 + λh·ρ
//   τ(1,0) = 1 + λa·ρ
//   τ(1,1) = 1 − ρ
//   τ(x,y) = 1        en cualquier otra celda
//
// Signo de ρ:
//   ρ < 0 → 0-0 y 1-1 AUMENTAN y 1-0/0-1 disminuyen (correlación positiva
//            típica del fútbol; valores publicados ≈ −0.13 a −0.10).
//   ρ > 0 → 0-0 y 1-1 DISMINUYEN y 1-0/0-1 aumentan.
//   ρ = 0 → τ ≡ 1: el modelo es EXACTAMENTE el Poisson independiente base.
//   RESTRICCIÓN ESTRUCTURAL: 0-0 y 1-1 se mueven en la MISMA dirección.
//
// Rango admisible = INTERSECCIÓN de las cotas de TODOS los partidos del fit
// (positividad τ>0 en todas las celdas de todos los partidos):
//   por partido i:  ρ < 1/(λh_i·λa_i)   (sólo restringe ρ>0)
//                   ρ > −1/λh_i  y  ρ > −1/λa_i  →  ρ > −1/max(λh_i,λa_i)
//                   ρ < 1
//   intersección:   rho_min = max_i( −1 / max(λh_i, λa_i) )
//                   rho_max = min_i( 1 / (λh_i · λa_i) )
//   rho ∈ ( rho_min , min(rho_max, 1) ) con un pequeño epsilon para no
//   tocar τ=0 exactamente.
// El rango se calcula SÓLO con los λ del período de fit (cero leakage); la
// positividad τ>0 en eval se verifica después como sanidad del experimento.
//
// Estimación: máxima verosimilitud CONDICIONAL (los λ de A se congelan;
// sólo se estima ρ):  max_ρ Σ log τ(x_i, y_i; λh_i, λa_i, ρ)  sobre los
// partidos de fit con celda ≤1 (los demás aportan log 1 = 0). Concavo en ρ
// (log de afín) → grid fino + refinamiento, determinista. Sin decaimiento
// temporal ξ (pesos uniformes, coherente con el protocolo V1/A del proyecto).
// IMPORTANTE: ll(ρ̂) − ll(0) es evidencia SÓLO in-sample (que el MLE ajustó el
// fit). La decisión DC-A vs A se evalúa EXCLUSIVAMENTE fuera de muestra.
// ---------------------------------------------------------------------------
const { aPorcentajes } = require("../services/prediccion/modelo_poisson");

const K = 15; // idéntico a K_MAX de modelo_poisson.js
const EPS = 1e-9;

// copia de modelo_poisson.poissonPmf
function poisPmf(k, lambda) {
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda + EPS) - Math.log(i);
  return Math.exp(logP);
}

function tau(x, y, lamH, lamA, rho) {
  if (x === 0 && y === 0) return 1 - lamH * lamA * rho;
  if (x === 0 && y === 1) return 1 + lamH * rho;
  if (x === 1 && y === 0) return 1 + lamA * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

// Matriz conjunta normalizada (rejilla y orden de acumulación idénticos a
// probsDesdeLambdas → con rho=0 el resultado float es bit a bit igual).
function matrizNorm(lamH, lamA, rho) {
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
      const p = pH[i] * pA[j] * tau(i, j, lamH, lamA, rho);
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
function probsDC(lamH, lamA, rho) {
  const m = matrizNorm(lamH, lamA, rho);
  return aPorcentajes(m.home, m.draw, m.away, 1);
}

// Rango admisible de ρ = INTERSECCIÓN de las cotas de todos los partidos del fit:
//   rho_min = max_i( -1 / max(lh_i, la_i) )      (cota activa sólo para ρ<0)
//   rho_max = min_i( 1 / (lh_i * la_i) )          (cota activa sólo para ρ>0)
//   rho ∈ ( rho_min, min(rho_max, 1) ) con epsilon para no tocar τ=0.
function rangoAdmisible(lams) {
  let lo = -Infinity; // intersección: máximo de las cotas inferiores
  let hi = Infinity;  // intersección: mínimo de las cotas superiores
  for (const { lh, la } of lams) {
    const maxL = Math.max(lh, la);
    if (maxL > 0) lo = Math.max(lo, -1 / maxL);
    const prod = lh * la;
    if (prod > 0) hi = Math.min(hi, 1 / prod);
  }
  if (!isFinite(lo)) lo = -1;
  if (!isFinite(hi)) hi = 1;
  hi = Math.min(hi, 1); // τ(1,1) = 1 − ρ > 0 → ρ < 1
  const EPS = 1e-6;     // margen interior para no llegar exactamente a τ=0
  lo = lo + EPS;
  hi = hi - EPS;
  if (!(lo < 0)) lo = -1e-6;
  if (!(hi > 0)) hi = 1e-6;
  if (!(lo < hi)) { lo = -1e-6; hi = 1e-6; }
  return { lo, hi };
}

// MLE de ρ: maximizar Σ log τ sobre celdas ≤1 del fit.
// low: [{ x, y, lh, la }] con x,y ∈ {0,1}.
function ajustarRho(low, { lo, hi }) {
  if (!low.length) return { rho: 0, llRho: 0, ll0: 0, rango: { lo, hi }, enBorde: false };
  const ll = (rho) => {
    let s = 0;
    for (const c of low) {
      const t = tau(c.x, c.y, c.lh, c.la, rho);
      if (t <= 0) return -Infinity;
      s += Math.log(t);
    }
    return s;
  };
  const N = 4001;
  const paso = (hi - lo) / (N - 1);
  let mejor = 0;
  let llMejor = -Infinity;
  for (let i = 0; i < N; i++) {
    const r = lo + i * paso;
    const v = ll(r);
    if (v > llMejor) { llMejor = v; mejor = r; }
  }
  const lo2 = Math.max(lo, mejor - paso);
  const hi2 = Math.min(hi, mejor + paso);
  const paso2 = (hi2 - lo2) / (N - 1);
  for (let i = 0; i < N; i++) {
    const r = lo2 + i * paso2;
    const v = ll(r);
    if (v > llMejor) { llMejor = v; mejor = r; }
  }
  const ll0 = ll(0);
  if (ll0 >= llMejor) return { rho: 0, llRho: ll0, ll0, rango: { lo, hi }, enBorde: false };
  const eps = Math.max(paso2, 1e-9);
  const enBorde = mejor - lo < eps || hi - mejor < eps;
  return { rho: mejor, llRho: llMejor, ll0, rango: { lo, hi }, enBorde };
}

module.exports = { K, poisPmf, tau, matrizNorm, probsDC, rangoAdmisible, ajustarRho };
