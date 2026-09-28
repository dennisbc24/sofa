// ---------------------------------------------------------------------------
// CALIBRADOR MULTICATEGORÍA tipo Platt para 3 clases (home/draw/away).
//
// Generalización multicategoría de Platt scaling mediante softmax sobre las
// log-probabilidades del modelo base:
//
//   x        = [ln p_home, ln p_draw, ln p_away]
//   z        = W·x + b          (W 3×3, b 3)
//   p'_k     = softmax(z)_k
//
// Propiedades:
//   - Identidad al iniciar (W = I, b = 0): si los datos no piden ninguna
//     corrección, p' ≈ p (softmax(ln p) = p exactamente).
//   - La diagonal de W actúa como "temperatura" por clase (reduce o aumenta
//     la confianza) y b corrige el sesgo de priores (p.ej. sesgo contra empates).
//   - Ajuste por MLE (Adam, batch completo) con penalización L2 hacia la
//     identidad: λ FIJO a priori (no se tunea en ninguna ventana de
//     evaluación → imposible que haya leakage de evaluación hacia λ).
//
// REGLA TEMPORAL (la aplica fase_calibracion.js): las muestras de entrenamiento
// del calibrador son predicciones FUERA de muestra del modelo base, obtenidas
// sobre un corte temporal interno estricto (día entero) anterior a cualquier
// partido de evaluación. Nunca se ajusta con las mismas predicciones que se
// usan para evaluar.
// ---------------------------------------------------------------------------
const CLASES = ["home", "draw", "away"];

function softmax(z) {
  const m = Math.max(z[0], z[1], z[2]);
  const e = [Math.exp(z[0] - m), Math.exp(z[1] - m), Math.exp(z[2] - m)];
  const s = e[0] + e[1] + e[2];
  return [e[0] / s, e[1] / s, e[2] / s];
}

// muestras: [{ frac: {home,draw,away} en fracción 0..1, real: "home"|"draw"|"away" }]
// opts: { lambda (L2 hacia identidad), iter, lr }
function ajustarPlatt(muestras, { lambda = 0.1, iter = 2000, lr = 0.05 } = {}) {
  const n = muestras ? muestras.length : 0;
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (n < 30) {
    // Muestra insuficiente → identidad (no se calibra) y se documenta.
    return { identidad: true, motivo: `n=${n} < 30`, n, lambda, iter: 0, W: I, b: [0, 0, 0], nllAntes: null, nllDespues: null };
  }
  const xs = muestras.map((m) => CLASES.map((k) => Math.log(Math.max(m.frac[k], 1e-12))));
  const ys = muestras.map((m) => CLASES.indexOf(m.real));

  const W = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const b = [0, 0, 0];

  const nllSolo = (Wr, br) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i];
      const z = [
        Wr[0][0] * x[0] + Wr[0][1] * x[1] + Wr[0][2] * x[2] + br[0],
        Wr[1][0] * x[0] + Wr[1][1] * x[1] + Wr[1][2] * x[2] + br[1],
        Wr[2][0] * x[0] + Wr[2][1] * x[1] + Wr[2][2] * x[2] + br[2],
      ];
      s -= Math.log(Math.max(softmax(z)[y], 1e-15));
    }
    return s / n;
  };
  const nllAntes = nllSolo(W, b);

  // Adam sobre el objetivo: media(NLL) + λ·(‖W−I‖² + ‖b‖²)
  const mW = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const vW = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const mb = [0, 0, 0];
  const vb = [0, 0, 0];
  const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;

  for (let t = 1; t <= iter; t++) {
    const gW = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const gb = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i];
      const z = [
        W[0][0] * x[0] + W[0][1] * x[1] + W[0][2] * x[2] + b[0],
        W[1][0] * x[0] + W[1][1] * x[1] + W[1][2] * x[2] + b[1],
        W[2][0] * x[0] + W[2][1] * x[1] + W[2][2] * x[2] + b[2],
      ];
      const p = softmax(z);
      for (let k = 0; k < 3; k++) {
        const d = (p[k] - (k === y ? 1 : 0)) / n;
        for (let j = 0; j < 3; j++) gW[k][j] += d * x[j];
        gb[k] += d;
      }
    }
    for (let k = 0; k < 3; k++) {
      gb[k] += 2 * lambda * b[k];
      for (let j = 0; j < 3; j++) {
        gW[k][j] += 2 * lambda * (W[k][j] - (k === j ? 1 : 0));
        mW[k][j] = beta1 * mW[k][j] + (1 - beta1) * gW[k][j];
        vW[k][j] = beta2 * vW[k][j] + (1 - beta2) * gW[k][j] * gW[k][j];
        const mHat = mW[k][j] / (1 - Math.pow(beta1, t));
        const vHat = vW[k][j] / (1 - Math.pow(beta2, t));
        W[k][j] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }
      mb[k] = beta1 * mb[k] + (1 - beta1) * gb[k];
      vb[k] = beta2 * vb[k] + (1 - beta2) * gb[k] * gb[k];
      const mHat = mb[k] / (1 - Math.pow(beta1, t));
      const vHat = vb[k] / (1 - Math.pow(beta2, t));
      b[k] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
    }
  }

  return {
    identidad: false,
    n,
    lambda,
    iter,
    W,
    b,
    nllAntes: Math.round(nllAntes * 10000) / 10000,
    nllDespues: Math.round(nllSolo(W, b) * 10000) / 10000,
  };
}

// params: salida de ajustarPlatt. frac: {home,draw,away} en fracción 0..1.
function aplicarPlatt(params, frac) {
  if (!params || params.identidad) return { home: frac.home, draw: frac.draw, away: frac.away };
  const x = CLASES.map((k) => Math.log(Math.max(frac[k], 1e-12)));
  const z = [0, 1, 2].map(
    (k) => params.W[k][0] * x[0] + params.W[k][1] * x[1] + params.W[k][2] * x[2] + params.b[k]
  );
  const p = softmax(z);
  return { home: p[0], draw: p[1], away: p[2] };
}

// Redondeo solo para reporte (el cómputo usa precisión completa).
function plattParaInforme(params) {
  const r = (x) => Math.round(x * 10000) / 10000;
  return {
    identidad: params.identidad,
    motivo: params.motivo,
    n: params.n,
    lambda: params.lambda,
    iter: params.iter,
    W: params.W.map((fila) => fila.map(r)),
    b: params.b.map(r),
    nllAntes: params.nllAntes,
    nllDespues: params.nllDespues,
  };
}

module.exports = { ajustarPlatt, aplicarPlatt, plattParaInforme, softmax };
