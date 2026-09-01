import { useMemo, useState } from "react"

const numero = (v) => (v === null || v === undefined ? "—" : v)

const COLUMNAS_EXPANDIDA = [
  { key: "liga", label: "Liga", type: "string" },
  { key: "fecha_jornada", label: "Jornada", type: "number" },
  { key: "equipo_local", label: "Local", type: "string" },
  { key: "equipo_visitante", label: "Visitante", type: "string" },
  { key: "goles_local_1t", label: "Goles L 1T", type: "number" },
  { key: "goles_visitante_1t", label: "Goles V 1T", type: "number" },
  { key: "goles_total_1t", label: "Total 1T", type: "number" },
  { key: "goles_local_2t", label: "Goles L 2T", type: "number" },
  { key: "goles_visitante_2t", label: "Goles V 2T", type: "number" },
  { key: "goles_total_2t", label: "Total 2T", type: "number" },
  { key: "remates_local_1t", label: "Rem L 1T", type: "number" },
  { key: "remates_visitante_1t", label: "Rem V 1T", type: "number" },
  { key: "remates_total_1t", label: "Rem Total 1T", type: "number" },
  { key: "remates_local_2t", label: "Rem L 2T", type: "number" },
  { key: "remates_visitante_2t", label: "Rem V 2T", type: "number" },
  { key: "remates_total_2t", label: "Rem Total 2T", type: "number" },
  { key: "corners_local_1t", label: "Corn L 1T", type: "number" },
  { key: "corners_visitante_1t", label: "Corn V 1T", type: "number" },
  { key: "corners_total_1t", label: "Corn Total 1T", type: "number" },
  { key: "corners_local_2t", label: "Corn L 2T", type: "number" },
  { key: "corners_visitante_2t", label: "Corn V 2T", type: "number" },
  { key: "corners_total_2t", label: "Corn Total 2T", type: "number" },
]

export const TablaAnalisisEquipo1T = ({ resultados }) => {
  if (!resultados?.length) return null

  return (
    <div className="tabla-scroll">
      <table className="tabla tabla-analisis-equipo1t">
        <thead>
          <tr>
            <th rowSpan={2}>Liga</th>
            <th rowSpan={2}>Jornada</th>
            <th rowSpan={2}>Local</th>
            <th rowSpan={2}>Visitante</th>
            <th colSpan={3}>Goles</th>
            <th colSpan={3}>Remates</th>
            <th colSpan={3}>Corners</th>
          </tr>
          <tr>
            <th>1T (L-V / Total)</th>
            <th>2T (L-V / Total)</th>
            <th>Total</th>
            <th>Local 1T</th>
            <th>Visita 1T</th>
            <th>Total 1T</th>
            <th>Local 1T</th>
            <th>Visita 1T</th>
            <th>Total 1T</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((r) => (
            <tr key={r.id}>
              <td>{r.liga}</td>
              <td>{numero(r.fecha_jornada)}</td>
              <td>{r.equipo_local}</td>
              <td>{r.equipo_visitante}</td>
              {/* Goles 1T: L-V / Total */}
              <td>{numero(r.goles_local_1t)} - {numero(r.goles_visitante_1t)} <span className="tabla-muted">({numero(r.goles_total_1t)})</span></td>
              <td>{numero(r.goles_local_2t)} - {numero(r.goles_visitante_2t)} <span className="tabla-muted">({numero(r.goles_total_2t)})</span></td>
              <td>{numero(r.goles_total)}</td>
              {/* Remates 1T/2T - mostraremos 1T detallado y 2T como tooltip o segunda fila? Para simplificar: 1T en columnas, 2T en title */}
              <td title={`2T: ${numero(r.remates_local_2t)} - ${numero(r.remates_visitante_2t)} (Total ${numero(r.remates_total_2t)})`}>{numero(r.remates_local_1t)}</td>
              <td title={`2T: ${numero(r.remates_local_2t)} - ${numero(r.remates_visitante_2t)} (Total ${numero(r.remates_total_2t)})`}>{numero(r.remates_visitante_1t)}</td>
              <td title={`2T total: ${numero(r.remates_total_2t)}`}>{numero(r.remates_total_1t)}</td>
              <td title={`2T: ${numero(r.corners_local_2t)} - ${numero(r.corners_visitante_2t)} (Total ${numero(r.corners_total_2t)})`}>{numero(r.corners_local_1t)}</td>
              <td title={`2T: ${numero(r.corners_local_2t)} - ${numero(r.corners_visitante_2t)} (Total ${numero(r.corners_total_2t)})`}>{numero(r.corners_visitante_1t)}</td>
              <td title={`2T total: ${numero(r.corners_total_2t)}`}>{numero(r.corners_total_1t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tabla-status">Hover en remates/corners para ver datos 2T. Ordenado por corners 1T ↓</p>
    </div>
  )
}

// Versión expandida con ordenamiento por columna (click en encabezado)
export const TablaAnalisisEquipo1TExpandida = ({ resultados }) => {
  const [sort, setSort] = useState({ key: null, dir: "asc" })

  const handleSort = (key) => {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      return { key, dir: "asc" }
    })
  }

  const sorted = useMemo(() => {
    if (!resultados?.length) return []
    if (!sort.key) return resultados
    const col = COLUMNAS_EXPANDIDA.find((c) => c.key === sort.key)
    const dir = sort.dir === "asc" ? 1 : -1
    return [...resultados].sort((a, b) => {
      const va = a[sort.key]
      const vb = b[sort.key]
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      if (col?.type === "number") return (Number(va) - Number(vb)) * dir
      return String(va).localeCompare(String(vb), "es", { sensitivity: "base" }) * dir
    })
  }, [resultados, sort])

  const flecha = (key) => {
    if (sort.key !== key) return " ↕"
    return sort.dir === "asc" ? " ↑" : " ↓"
  }

  if (!resultados?.length) return null

  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            {COLUMNAS_EXPANDIDA.map((c) => (
              <th
                key={c.key}
                onClick={() => handleSort(c.key)}
                title={`Ordenar por ${c.label} ${sort.key === c.key ? (sort.dir === "asc" ? "↓" : "↑") : ""}`}
                style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
              >
                {c.label}{flecha(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>{r.liga}</td>
              <td>{numero(r.fecha_jornada)}</td>
              <td>{r.equipo_local}</td>
              <td>{r.equipo_visitante}</td>
              <td>{numero(r.goles_local_1t)}</td>
              <td>{numero(r.goles_visitante_1t)}</td>
              <td>{numero(r.goles_total_1t)}</td>
              <td>{numero(r.goles_local_2t)}</td>
              <td>{numero(r.goles_visitante_2t)}</td>
              <td>{numero(r.goles_total_2t)}</td>
              <td>{numero(r.remates_local_1t)}</td>
              <td>{numero(r.remates_visitante_1t)}</td>
              <td>{numero(r.remates_total_1t)}</td>
              <td>{numero(r.remates_local_2t)}</td>
              <td>{numero(r.remates_visitante_2t)}</td>
              <td>{numero(r.remates_total_2t)}</td>
              <td>{numero(r.corners_local_1t)}</td>
              <td>{numero(r.corners_visitante_1t)}</td>
              <td>{numero(r.corners_total_1t)}</td>
              <td>{numero(r.corners_local_2t)}</td>
              <td>{numero(r.corners_visitante_2t)}</td>
              <td>{numero(r.corners_total_2t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tabla-status">Click en encabezado para ordenar A-Z / menor-mayor. Orden actual: {sort.key ? `${sort.key} ${sort.dir === "asc" ? "↑" : "↓"}` : "por defecto (corners 1T ↓)"}</p>
    </div>
  )
}
