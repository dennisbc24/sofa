// ---------------------------------------------------------------------------
// Tema de la pagina: "tema-pred" (1X2, oscuro azul + cyan) o "tema-2t"
// (proyeccion 2T, claro lila + magenta). Se aplica al body para que
// cambien el fondo de pagina y todas las superficies.
// El historial lo reescribe segun el tipo de la prediccion que se este
// viendo (1X2 o 2T), de modo que la vista del detalle tenga su theme.
// ---------------------------------------------------------------------------
export const TEMA_PRED = "tema-pred"
export const TEMA_2T = "tema-2t"

export const temaDeTipo = (tipo) => (tipo === "2t" ? TEMA_2T : TEMA_PRED)

export const aplicarTema = (tema) => {
  if (typeof document === "undefined") return
  document.body.classList.remove(TEMA_PRED, TEMA_2T)
  document.body.classList.add(tema)
}
