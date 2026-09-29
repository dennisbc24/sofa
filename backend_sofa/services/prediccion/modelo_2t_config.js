// ---------------------------------------------------------------------------
// PUNTO ÚNICO DE SELECCIÓN DEL MODELO OPERATIVO DE PROYECCIÓN 2T.
//
// Espejo de services/prediccion/modelo_config.js (que gobierna el pre-partido
// 1X2 V1_BETA) pero para la predicción 2T: registry SEPARADO para no tocar
// la configuración del beta 1X2 existente.
//
// Cambiar CURRENT_PREDICTION_MODEL_2T basta para que backend y frontend pasen
// a usar otra versión de la proyección 2T (V1_BETA_2T → futuras versiones)
// sin tocar controllers, servicios ni componentes.
// El endpoint NUNCA entrena: sólo lee el JSON entrenado.
// ---------------------------------------------------------------------------
const CURRENT_PREDICTION_MODEL_2T = "V1_BETA_2T";

const MODELOS_OPERATIVOS_2T = {
  V1_BETA_2T: {
    id: "V1_BETA_2T",
    version: "1.0",
    estado: "BETA",
    descripcion:
      "Primer beta de la predicción 2T: blend por stat (B/TR/R/T) con media de equipo+shrinkage, ridge de 11 features de 1T/historial, media de liga (L0) y el port del heurístico H (Proyección 2T actual)",
    archivo: "modelos/prediccion_2t.json",
    backtest: "experimentos_fase2t/informes/fase2t_0_backtest.json",
    seleccionadoEn:
      "TEST temporal (288 partidos / 576 lados, 2026-08-02…2026-09-28): Goles 0.7457 vs H 0.8297 (+10.12%), Remates 2.7444 vs 3.8581 (+28.87%), Corners 1.4845 vs 1.9052 (+22.08%); resto 35/38 no-peor vs min(T,L0)",
    entrenamiento:
      "scripts/entrenar_modelo_2t.js sobre 1.926 partidos de la DB local (2019-2026, cero datos externos); refit con TRAIN+VAL+TEST tras la evaluación",
    confirmacion: {
      fase: "experimentos_fase2t/fase2t_1_confirmacion.js",
      estado: "PENDIENTE — se ejecuta con ≥150 partidos > 2026-09-28 (pre-registrado 2026-09-29 con 0 futuros; evaluación única por cohorte)",
    },
    nota:
      "Beta reemplazable: sustituir V1_BETA_2T por futuras versiones en este archivo sin cambiar el resto del sistema.",
  },
  // Futuras versiones (V2_2T, etc.) se agregarán aquí cuando se decidan.
};

function modeloActivo2T() {
  const m = MODELOS_OPERATIVOS_2T[CURRENT_PREDICTION_MODEL_2T];
  if (!m) throw new Error(`Modelo 2T activo desconocido: ${CURRENT_PREDICTION_MODEL_2T}`);
  return m;
}

module.exports = { CURRENT_PREDICTION_MODEL_2T, MODELOS_OPERATIVOS_2T, modeloActivo2T };
