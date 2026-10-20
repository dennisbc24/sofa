// ---------------------------------------------------------------------------
// Card de predicción 1X2 (estilo pre-partido), reutilizable en:
//  - Predicción en vivo (1X2)
//  - Historial pre-partido
//  - Proyección 2T (pantalla e historial)
// Muestra: partido, fecha, predicción principal, resultado real (si existe)
// y la rejilla de probabilidades con el predicho y el real resaltados.
// ---------------------------------------------------------------------------
export const CardPrediccion1x2 = ({
  titulo = "Predicción",
  local,
  visitante,
  fecha,
  probabilidades,
  predicho,
  probabilidad,
  real,
  marcador,
  chip = null,
  nota = null,
  colapsado = false,
  onToggle = null,
}) => {
  if (!probabilidades) return null
  const probs = [
    { key: "home", etiqueta: local || "Local", valor: probabilidades.home },
    { key: "draw", etiqueta: "Empate", valor: probabilidades.draw },
    { key: "away", etiqueta: visitante || "Visita", valor: probabilidades.away },
  ]
  const favorito = probs.reduce((a, b) => (a.valor >= b.valor ? a : b))
  const acierto = real && predicho ? real === predicho : null
  const etq = (k) => probs.find((p) => p.key === k)?.etiqueta || k
  const boton = onToggle ? (
    <button className="btn-link card-toggle" onClick={onToggle}>
      {colapsado ? "▸ ver predicción" : "▾ ocultar"}
    </button>
  ) : null

  // Colapsada: una sola línea con lo esencial.
  if (colapsado) {
    return (
      <section className="card card-colapsada">
        <div className="card-header">
          {titulo} — {local} vs {visitante}
          {chip}
          {boton}
        </div>
        <div className="result-row">
          <span className="result-label">Resumen</span>
          <span className="result-value">
            <strong>{etq(predicho)}</strong>
            {probabilidad != null && ` (${probabilidad}%)`}
            {real && (
              <>
                {" "}· real <strong>{etq(real)}</strong>
                {marcador ? ` (${marcador.local}-${marcador.visita})` : ""} {" "}
                <span className={`resultado-chip ${acierto ? "resultado-v" : "resultado-d"}`}>
                  {acierto ? "✓ acertada" : "✗ fallada"}
                </span>
              </>
            )}
          </span>
        </div>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="card-header">
        {titulo} — {local} vs {visitante}
        {chip}
        {boton}
      </div>
      <div className="result-row">
        <span className="result-label">Partido</span>
        <span className="result-value">{local} vs {visitante}</span>
      </div>
      {fecha && (
        <div className="result-row">
          <span className="result-label">Fecha del partido</span>
          <span className="result-value">{fecha}</span>
        </div>
      )}
      <div className="result-row">
        <span className="result-label">Predicción principal</span>
        <span className="result-value">
          {probs.find((p) => p.key === predicho)?.etiqueta || favorito.etiqueta}
          {probabilidad != null && ` (${probabilidad}%)`}
        </span>
      </div>
      {real && (
        <div className="result-row">
          <span className="result-label">Resultado real</span>
          <span className="result-value">
            {probs.find((p) => p.key === real)?.etiqueta || real}
            {marcador ? ` (${marcador.local}-${marcador.visita})` : ""}{" "}
            <span className={`resultado-chip ${acierto ? "resultado-v" : "resultado-d"}`}>
              {acierto ? "✓ acertada" : "✗ fallada"}
            </span>
          </span>
        </div>
      )}
      <div className="prob-grid">
        {probs.map((p) => (
          <div
            key={p.key}
            className={[
              "prob-item",
              p.key === predicho ? "prob-item-fav" : "",
              p.key === real ? "prob-item-real" : "",
            ].join(" ").trim()}
          >
            <div className="prob-etiqueta">
              {p.etiqueta}
              {p.key === predicho ? " (predicho)" : ""}
              {p.key === real ? " (real)" : ""}
            </div>
            <div className="prob-valor">{p.valor}%</div>
            <div className="prob-barra">
              <span style={{ width: `${p.valor}%` }} />
            </div>
          </div>
        ))}
      </div>
      {nota && <p className="tabla-status">{nota}</p>}
    </section>
  )
}
