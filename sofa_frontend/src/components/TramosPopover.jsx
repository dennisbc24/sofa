import { useEffect } from "react"
import { fmtTramo as fmt, pctTramo as pct } from "../tramos.js"

export const TramosPopover = ({ datos, etiqueta, local, visita, col, pos, onCerrar }) => {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCerrar()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCerrar])

  if (!datos || !datos.tramos) return null

  const celda = (lado, tramo) => {
    const activa = col === lado ? " tramos-col-activa" : ""
    const v = tramo[lado] || {}
    return (
      <td className={`tabla-num${activa}`}>
        <span className="tramos-lambda">λ {fmt(v.lambda)}</span>
        <span className="tramos-p1">{pct(v.p1)}</span>
      </td>
    )
  }

  return (
    <div className="tramos-backdrop" onClick={onCerrar}>
      <div
        className="tramos-popover"
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        role="dialog"
        aria-label={`Desglose de ${etiqueta} por tramos del 2T`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tramos-header">
          <div>
            <div className="tramos-titulo">{etiqueta} · proyección 2T</div>
            <div className="tramos-sub">
              {local || "Local"} vs {visita || "Visita"}
            </div>
          </div>
          <button className="tramos-cerrar" onClick={onCerrar} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="tabla-scroll">
          <table className="tabla tramos-tabla">
            <thead>
              <tr>
                <th>Tramo</th>
                <th className={col === "local" ? "tramos-col-activa" : ""}>{local || "Local"}</th>
                <th className={col === "visita" ? "tramos-col-activa" : ""}>{visita || "Visita"}</th>
                <th className={col === "total" ? "tramos-col-activa" : ""}>Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.tramos.map((t) => (
                <tr key={t.id}>
                  <td>{t.etiqueta}</td>
                  {celda("local", t)}
                  {celda("visita", t)}
                  {celda("total", t)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="tramos-nota">
          λ = promedio esperado del tramo. % = probabilidad de al menos 1. El tramo 76-90+
          incluye el tiempo añadido.
        </p>
      </div>
    </div>
  )
}
