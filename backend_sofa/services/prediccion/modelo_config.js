// ---------------------------------------------------------------------------
// PUNTO ÚNICO DE SELECCIÓN DEL MODELO OPERATIVO.
//
// Cambiar CURRENT_PREDICTION_MODEL basta para que backend y frontend pasen a
// usar otra versión (V1_BETA → V2/Elo → futuras versiones → modelo definitivo)
// sin tocar controllers, servicios ni componentes.
//
// La predicción siempre la ejecuta services/prediccion/ con el modelo que aquí
// se indique; esta beta NO entrena en el request, solo lee el JSON entrenado.
// ---------------------------------------------------------------------------
const CURRENT_PREDICTION_MODEL = "V1_BETA";

const MODELOS_OPERATIVOS = {
  V1_BETA: {
    id: "V1_BETA",
    version: "V1.1",
    descripcion:
      "V1 Poisson base (parámetros sin cambios) + parche de robustez 1.1: μ por familia de liga en el rollover de temporada y guardrail λ≤8",
    archivo: "modelos/prediccion_poisson.json",
    incluye: { platt: false, elo: false, xg: false, remates: false },
    seleccionadoEn:
      "Evaluación final sobre TEST: V1 (LL 0.9719 / Brier 0.5780 / ECE 0.0673) vs V1+Platt (0.9787 / 0.5830 / 0.0913).",
    parche11: {
      evaluadoEn: "experimentos_fase11/informes/fase11_1_eval_rollover.json",
      familia: "VAL con liga renombrada (rollover simulado): ΔLL −0.0085 overall / −0.0089 en resolvibles; despliegue 369/386 partidos post-VAL dejan de caer a μ global",
      guardrail: "λ≤8: peor-ll de VAL 6.21 → 4.61, ≤5 partidos tocados, sin deterioro de LL",
      parametrosJson: "INTACTOS (F6E3405C…5BD1): el parche es sólo de inferencia; version del JSON (1.0) = artefacto entrenado, version V1.1 = configuración desplegada",
    },
    nota:
      "Beta reemplazable: sustituir V1_BETA por futuras versiones en este archivo sin cambiar el resto del sistema.",
  },
  // Futuras versiones (V2/Elo, etc.) se agregarán aquí cuando se decidan.
};

function modeloActivo() {
  const m = MODELOS_OPERATIVOS[CURRENT_PREDICTION_MODEL];
  if (!m) throw new Error(`Modelo activo desconocido: ${CURRENT_PREDICTION_MODEL}`);
  return m;
}

module.exports = { CURRENT_PREDICTION_MODEL, MODELOS_OPERATIVOS, modeloActivo };
