// ---------------------------------------------------------------------------
// FASE 3.8 — CAPAS DE CALIBRACIÓN DE EMPATE sobre V1 (base = producción).
// EXCLUSIVO DE INVESTIGACIÓN: sin TEST, sin tocar producción.
//
// Tres variantes pre-registradas:
//  M0 (diagnóstico, no candidato): Platt sobre P(E): logit P(E)' = a + b·logit P(E)
//  M1 (candidato): logística de empate con señales de equilibrio:
//      logit P(E)' = a + b·logit P(E) + c·|ΔElo|/400 + d·(λh+λa) + e·tasaLiga
//      → masa (1−P(E)) se redistribuye a H/V proporcionalmente (odds H:V intactos)
//  M2 (candidato): softmax 6 clases {H, 0-0, 1-1, 2-2, otrosE, V}:
//      l_k = a_k + b_k·log p_k(base) + c_k·|ΔElo|/400 + d_k·(λh+λa) + e_k·tasaLiga
//      → arregla la composición 0-0/1-1/2-2 INDEPENDIENTEMENTE (a diferencia de
//        DC/Davidson, que sólo reponderan la diagonal entera)
// Todas las funciones tienen IDENTIDAD EXACTA con parámetros neutros
// (sanidad obligatoria). Convexas (logística/multinomial) con L2 pequeño.
// ---------------------------------------------------------------------------
const { poisPmf, K } = require("./davidson");

const CELDAS_CLASE = ["H", "E00", "E11", "E22", "Eo", "V"];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const logit = (p) => { const q = clamp(p, 1e-9, 1 - 1e-9); return Math.log(q / (1 - q)); };
const sig = (z) => 1 / (1 + Math.exp(-clamp(z, -60, 60)));

// Predicción base V1 (sin covariables) con probabilidades CRUDAS de 1X2 y de
// las 6 clases M2. Misma normalización Z que probsDesdeLambdas (K=15).
function predsBase(modelo, partidos) {
  const ligas = modelo.ligas || {};
  const att = modelo.att || {}, def = modelo.def || {};
  return partidos.map((p) => {
    const base = ligas[p.liga] || { muHome: modelo.muHomeGlobal, muAway: modelo.muAwayGlobal };
    const lh = Math.exp(Math.log(base.muHome) + (att[p.home] ?? 0) - (def[p.away] ?? 0));
    const la = Math.exp(Math.log(base.muAway) + (att[p.away] ?? 0) - (def[p.home] ?? 0));
    const pHv = [], pAv = [];
    for (let k = 0; k <= K; k++) { pHv.push(poisPmf(k, lh)); pAv.push(poisPmf(k, la)); }
    let Z = 0, H = 0, V = 0, E = 0, E00 = 0, E11 = 0, E22 = 0;
    for (let i = 0; i <= K; i++) for (let j = 0; j <= K; j++) {
      const q = pHv[i] * pAv[j]; Z += q;
      if (i > j) H += q;
      else if (i < j) V += q;
      else { E += q; if (i === 0) E00 += q; else if (i === 1) E11 += q; else if (i === 2) E22 += q; }
    }
    const Eo = Math.max(0, E - E00 - E11 - E22);
    const real = p.goalsH > p.goalsA ? "home" : p.goalsH === p.goalsA ? "draw" : "away";
    return {
      fecha: p.fecha, id: p.id, home: p.home, away: p.away, liga: p.liga,
      lh, la, real, marcador: `${p.goalsH}-${p.goalsA}`,
      pH: H / Z, pE: E / Z, pV: V / Z,
      cells: { H: H / Z, E00: E00 / Z, E11: E11 / Z, E22: E22 / Z, Eo: Eo / Z, V: V / Z },
      fElo: p.fElo, fLiga: p.fLiga,
    };
  });
}

// |ΔElo|/400 por partido (ratings previos, cronológicos — del llamador).
const construirFElo = (antes) => antes.map((a) => Math.abs(a.home - a.away) / 400);

// Tasa de empates PREVIA de la liga, corte día estricto (sólo días anteriores);
// fallback a la tasa global previa si la liga tiene <10 partidos previos, y a
// 0.25 si no hay historia. Sin fuga: cada partido se ve DESPUÉS de flush de su día.
function construirFLiga(TV) {
  const dia = (m) => new Date(m.fecha).toISOString().slice(0, 10);
  const porLiga = new Map();
  let gN = 0, gD = 0;
  const out = new Array(TV.length);
  let i = 0;
  while (i < TV.length) {
    const d = dia(TV[i]);
    let j = i;
    while (j < TV.length && dia(TV[j]) === d) j += 1;
    for (let k = i; k < j; k++) {
      const p = TV[k];
      const L = porLiga.get(p.liga) || { n: 0, d: 0 };
      const useL = L.n >= 10;
      const n = useL ? L.n : gN, dd = useL ? L.d : gD;
      out[k] = n > 0 ? dd / n : 0.25;
    }
    for (let k = i; k < j; k++) {
      const p = TV[k];
      const esEmpate = p.goalsH === p.goalsA;
      const L = porLiga.get(p.liga) || { n: 0, d: 0 };
      L.n += 1; if (esEmpate) L.d += 1;
      porLiga.set(p.liga, L);
      gN += 1; if (esEmpate) gD += 1;
    }
    i = j;
  }
  return out;
}

// ---- M0/M1: logística de empate -------------------------------------------
// items: predsBase (con fElo/fLiga). soloBase=true → M0 (sólo logit P(E)).
function ajustarM1(items, { soloBase = false, l2 = 0.01, iters = 4000 } = {}) {
  const y = items.map((it) => (it.real === "draw" ? 1 : 0));
  const x1 = items.map((it) => logit(it.pE));
  const x2 = items.map((it) => it.fElo);
  const x3 = items.map((it) => it.lh + it.la);
  const x4 = items.map((it) => it.fLiga);
  const k = soloBase ? 1 : 4;
  const fila = (i) => (soloBase ? [x1[i]] : [x1[i], x2[i], x3[i], x4[i]]);
  const n = items.length;
  const pMed = Math.min(0.999, Math.max(0.001, y.reduce((s, v) => s + v, 0) / n));
  let a = logit(pMed);
  const w = new Array(k).fill(0);
  const nll = (aa, ww) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      let z = aa; const f = fila(i);
      for (let j = 0; j < k; j++) z += ww[j] * f[j];
      const p = sig(z);
      s += y[i] ? -Math.log(Math.max(1e-15, p)) : -Math.log(Math.max(1e-15, 1 - p));
    }
    let reg = 0; for (let j = 0; j < k; j++) reg += ww[j] * ww[j];
    return s / n + l2 * reg;
  };
  const grad = () => {
    const ga = 0; const gw = new Array(k).fill(0); let acc = ga;
    for (let i = 0; i < n; i++) {
      let z = a; const f = fila(i);
      for (let j = 0; j < k; j++) z += w[j] * f[j];
      const dz = sig(z) - y[i];
      acc += dz; const ff = fila(i);
      for (let j = 0; j < k; j++) gw[j] += dz * ff[j];
    }
    for (let j = 0; j < k; j++) gw[j] = gw[j] / n + 2 * l2 * w[j];
    return { ga: acc / n, gw };
  };
  let lr = 0.5;
  let actual = nll(a, w);
  const nll0 = actual;
  for (let t = 0; t < iters; t++) {
    const { ga, gw } = grad();
    let mejor = false;
    for (let r = 0; r < 20 && !mejor; r++) {
      const a2 = a - lr * ga; const w2 = w.map((v, j) => v - lr * gw[j]);
      const v2 = nll(a2, w2);
      if (v2 <= actual - 1e-12) { a = a2; for (let j = 0; j < k; j++) w[j] = w2[j]; actual = v2; lr *= 1.05; mejor = true; }
      else lr *= 0.5;
    }
    if (!mejor) break;
    if (Math.abs(ga) < 1e-10 && gw.every((g) => Math.abs(g) < 1e-10)) break;
  }
  return { a, w, k, nllFinal: actual, nll0, n, soloBase };
}

function aplicarM1(params, it) {
  const { a, w, soloBase } = params;
  let z = a + w[0] * logit(it.pE);
  if (!soloBase) z += w[1] * it.fElo + w[2] * (it.lh + it.la) + w[3] * it.fLiga;
  const pE = clamp(sig(z), 1e-9, 1 - 1e-9);
  const esc = (1 - pE) / Math.max(1e-15, 1 - it.pE);
  return { pH: it.pH * esc, pE, pV: it.pV * esc, cellsEscala: (it.pE > 1e-15 ? pE / it.pE : 1) };
}

// ---- M2: softmax 6 clases --------------------------------------------------
function ajustarM2(items, { l2 = 0.01, iters = 4000 } = {}) {
  const n = items.length;
  const claseDe = (it) => (it.real === "home" ? 0 : it.real === "away" ? 5
    : it.marcador === "0-0" ? 1 : it.marcador === "1-1" ? 2 : it.marcador === "2-2" ? 3 : 4);
  const y = items.map(claseDe);
  const L = items.map((it) => CELDAS_CLASE.map((c) => Math.log(Math.max(1e-15, it.cells[c]))));
  const F = items.map((it) => [it.fElo, it.lh + it.la, it.fLiga]);
  const nk = CELDAS_CLASE.length;
  const freq = new Array(nk).fill(0);
  for (const yi of y) freq[yi] += 1;
  const A = freq.map((f) => Math.log((f + 0.5) / (n + 0.5 * nk)));
  const B = new Array(nk).fill(1);
  const C = new Array(nk).fill(0);
  const D = new Array(nk).fill(0);
  const E = new Array(nk).fill(0);
  const logits = (i) => {
    const l = new Array(nk);
    for (let k = 0; k < nk; k++) l[k] = A[k] + B[k] * L[i][k] + C[k] * F[i][0] + D[k] * F[i][1] + E[k] * F[i][2];
    return l;
  };
  const nll = () => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const l = logits(i); const mx = Math.max(...l);
      let zsum = 0; for (const v of l) zsum += Math.exp(v - mx);
      s += -(l[y[i]] - mx - Math.log(zsum));
    }
    let reg = 0;
    for (let k = 0; k < nk; k++) reg += B[k] ** 2 + C[k] ** 2 + D[k] ** 2 + E[k] ** 2;
    return s / n + l2 * reg / nk;
  };
  const grad = () => {
    const gA = new Array(nk).fill(0), gB = new Array(nk).fill(0), gC = new Array(nk).fill(0), gD = new Array(nk).fill(0), gE = new Array(nk).fill(0);
    for (let i = 0; i < n; i++) {
      const l = logits(i); const mx = Math.max(...l);
      const ex = l.map((v) => Math.exp(v - mx));
      const zs = ex.reduce((s, v) => s + v, 0);
      const pr = ex.map((v) => v / zs);
      for (let k = 0; k < nk; k++) {
        const d = pr[k] - (y[i] === k ? 1 : 0);
        gA[k] += d; gB[k] += d * L[i][k]; gC[k] += d * F[i][0]; gD[k] += d * F[i][1]; gE[k] += d * F[i][2];
      }
    }
    for (let k = 0; k < nk; k++) {
      gA[k] /= n;
      gB[k] = gB[k] / n + (2 * l2 / nk) * B[k];
      gC[k] = gC[k] / n + (2 * l2 / nk) * C[k];
      gD[k] = gD[k] / n + (2 * l2 / nk) * D[k];
      gE[k] = gE[k] / n + (2 * l2 / nk) * E[k];
    }
    return { gA, gB, gC, gD, gE };
  };
  let lr = 0.5;
  let actual = nll();
  const nll0 = actual;
  for (let t = 0; t < iters; t++) {
    const g = grad();
    let mejor = false;
    for (let r = 0; r < 20 && !mejor; r++) {
      const A2 = A.map((v, k) => v - lr * g.gA[k]);
      const B2 = B.map((v, k) => v - lr * g.gB[k]);
      const C2 = C.map((v, k) => v - lr * g.gC[k]);
      const D2 = D.map((v, k) => v - lr * g.gD[k]);
      const E2 = E.map((v, k) => v - lr * g.gE[k]);
      const guard = [A.slice(), B.slice(), C.slice(), D.slice(), E.slice()];
      A.splice(0, nk, ...A2); B.splice(0, nk, ...B2); C.splice(0, nk, ...C2); D.splice(0, nk, ...D2); E.splice(0, nk, ...E2);
      const v2 = nll();
      if (v2 <= actual - 1e-12) { actual = v2; lr *= 1.05; mejor = true; }
      else { A.splice(0, nk, ...guard[0]); B.splice(0, nk, ...guard[1]); C.splice(0, nk, ...guard[2]); D.splice(0, nk, ...guard[3]); E.splice(0, nk, ...guard[4]); lr *= 0.5; }
    }
    if (!mejor) break;
  }
  return { A: [...A], B: [...B], C: [...C], D: [...D], E: [...E], nllFinal: actual, nll0, n };
}

function aplicarM2(params, it) {
  const { A, B, C, D, E } = params;
  const L = CELDAS_CLASE.map((c) => Math.log(Math.max(1e-15, it.cells[c])));
  const F = [it.fElo, it.lh + it.la, it.fLiga];
  const l = CELDAS_CLASE.map((_, k) => A[k] + B[k] * L[k] + C[k] * F[0] + D[k] * F[1] + E[k] * F[2]);
  const mx = Math.max(...l);
  const ex = l.map((v) => Math.exp(v - mx));
  const zs = ex.reduce((s, v) => s + v, 0);
  const cls = {};
  CELDAS_CLASE.forEach((c, k) => { cls[c] = ex[k] / zs; });
  return { pH: cls.H, pE: cls.E00 + cls.E11 + cls.E22 + cls.Eo, pV: cls.V, cls };
}

// Celda del marcador tras la capa: por clase (M2 agrega masa por clase; M0/M1
// escala todos los empates por el mismo factor) conservando la estructura base.
function celdaTrasCapa(it, salida, x, y) {
  const base = (() => {
    const pHv = [], pAv = [];
    for (let k = 0; k <= K; k++) { pHv.push(poisPmf(k, it.lh)); pAv.push(poisPmf(k, it.la)); }
    let Z = 0; for (let i = 0; i <= K; i++) for (let j = 0; j <= K; j++) Z += pHv[i] * pAv[j];
    return (pHv[x] * pAv[y]) / Z;
  })();
  if (salida.cls) {
    const clase = x > y ? "H" : x < y ? "V" : x === 0 ? "E00" : x === 1 ? "E11" : x === 2 ? "E22" : "Eo";
    return base * (salida.cls[clase] / Math.max(1e-15, it.cells[clase]));
  }
  const clase = x > y ? "H" : x < y ? "V" : "E";
  const factorE = salida.pE / Math.max(1e-15, it.pE);
  const factorNV = (1 - salida.pE) / Math.max(1e-15, 1 - it.pE);
  return base * (clase === "E" ? factorE : factorNV);
}

module.exports = {
  CELDAS_CLASE, predsBase, construirFElo, construirFLiga,
  ajustarM1, aplicarM1, ajustarM2, aplicarM2, celdaTrasCapa, logit, sig,
};
