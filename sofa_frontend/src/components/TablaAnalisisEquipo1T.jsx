import { useMemo, useState } from "react"

const numero = (v) => (v === null || v === undefined ? "—" : v)

const IconLocal = ({ size = 13, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ verticalAlign: "middle", ...style }}>
    <path d="M12 3L2 12h3v8h6v-6h2v6h6v-8h3z" />
  </svg>
)
const IconVisita = ({ size = 13, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ verticalAlign: "middle", ...style }}>
    <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-2 0V9L3 14v2l8-2.5 8 2.5z" />
  </svg>
)
const COLUMNAS_EXPANDIDA = [
  { key: "liga", label: "Liga", type: "string" },
  { key: "fecha_jornada", label: "Jornada", type: "number" },
  { key: "equipo_local", label: "Local", type: "string", icon: "local" },
  { key: "equipo_visitante", label: "Visitante", type: "string", icon: "visita" },
  { key: "goles_local_1t", label: "Goles L 1T", type: "number", icon: "local" },
  { key: "goles_visitante_1t", label: "Goles V 1T", type: "number", icon: "visita" },
  { key: "goles_total_1t", label: "Total 1T", type: "number" },
  { key: "goles_local_2t", label: "Goles L 2T", type: "number", icon: "local" },
  { key: "goles_visitante_2t", label: "Goles V 2T", type: "number", icon: "visita" },
  { key: "goles_total_2t", label: "Total 2T", type: "number" },
  { key: "remates_local_1t", label: "Rem L 1T", type: "number", icon: "local" },
  { key: "remates_visitante_1t", label: "Rem V 1T", type: "number", icon: "visita" },
  { key: "remates_total_1t", label: "Rem Total 1T", type: "number" },
  { key: "remates_local_2t", label: "Rem L 2T", type: "number", icon: "local" },
  { key: "remates_visitante_2t", label: "Rem V 2T", type: "number", icon: "visita" },
  { key: "remates_total_2t", label: "Rem Total 2T", type: "number" },
  { key: "corners_local_1t", label: "Corn L 1T", type: "number", icon: "local" },
  { key: "corners_visitante_1t", label: "Corn V 1T", type: "number", icon: "visita" },
  { key: "corners_total_1t", label: "Corn Total 1T", type: "number" },
  { key: "corners_local_2t", label: "Corn L 2T", type: "number", icon: "local" },
  { key: "corners_visitante_2t", label: "Corn V 2T", type: "number", icon: "visita" },
  { key: "corners_total_2t", label: "Corn Total 2T", type: "number" },
]

export const TablaAnalisisEquipo1T = ({ resultados }) => {
  const [sort, setSort] = useState({ key: null, dir: "asc" })

  const handleSort = (key) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))
  }

  const flecha = (key) => (sort.key !== key ? " ↕" : sort.dir === "asc" ? " ↑" : " ↓")

  const thStyle = (key) => ({
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    background: sort.key === key ? "var(--color-accent, #eef)" : undefined,
  })

  const sorted = useMemo(() => {
    if (!resultados?.length) return []
    if (!sort.key) return resultados
    const dir = sort.dir === "asc" ? 1 : -1
    const isNum = ["fecha_jornada", "goles_total_1t", "goles_total_2t", "goles_total", "remates_local_1t", "remates_visitante_1t", "remates_total_1t", "corners_local_1t", "corners_visitante_1t", "corners_total_1t"].includes(sort.key)
    return [...resultados].sort((a, b) => {
      const va = a[sort.key]
      const vb = b[sort.key]
      if (va == null) return 1
      if (vb == null) return -1
      if (isNum) return (Number(va) - Number(vb)) * dir
      return String(va).localeCompare(String(vb), "es", { sensitivity: "base" }) * dir
    })
  }, [resultados, sort])

  if (!resultados?.length) return null

  return (
    <div className="tabla-scroll">
      <table className="tabla tabla-analisis-equipo1t">
        <thead>
          <tr>
            <th rowSpan={2} onClick={() => handleSort("liga")} style={thStyle("liga")} title="Ordenar por Liga">Liga{flecha("liga")}</th>
            <th rowSpan={2} onClick={() => handleSort("fecha_jornada")} style={thStyle("fecha_jornada")} title="Ordenar por Jornada">Jornada{flecha("fecha_jornada")}</th>
            <th rowSpan={2} onClick={() => handleSort("equipo_local")} style={thStyle("equipo_local")} title="Ordenar por Local (casa)">Local <IconLocal />{flecha("equipo_local")}</th>
            <th rowSpan={2} onClick={() => handleSort("equipo_visitante")} style={thStyle("equipo_visitante")} title="Ordenar por Visitante (avión)">Visitante <IconVisita />{flecha("equipo_visitante")}</th>
            <th colSpan={3}>Goles</th>
            <th colSpan={3}>Remates</th>
            <th colSpan={3}>Corners</th>
          </tr>
          <tr>
            <th onClick={() => handleSort("goles_total_1t")} style={thStyle("goles_total_1t")} title="Ordenar por Goles 1T">1T (L-V / Total){flecha("goles_total_1t")}</th>
            <th onClick={() => handleSort("goles_total_2t")} style={thStyle("goles_total_2t")} title="Ordenar por Goles 2T">2T (L-V / Total){flecha("goles_total_2t")}</th>
            <th onClick={() => handleSort("goles_total")} style={thStyle("goles_total")} title="Ordenar por Total">Total{flecha("goles_total")}</th>
            <th onClick={() => handleSort("remates_local_1t")} style={thStyle("remates_local_1t")} title="Ordenar por Rem Local">Local 1T <IconLocal />{flecha("remates_local_1t")}</th>
            <th onClick={() => handleSort("remates_visitante_1t")} style={thStyle("remates_visitante_1t")} title="Ordenar por Rem Visita">Visita 1T <IconVisita />{flecha("remates_visitante_1t")}</th>
            <th onClick={() => handleSort("remates_total_1t")} style={thStyle("remates_total_1t")} title="Ordenar por Rem Total">Total 1T{flecha("remates_total_1t")}</th>
            <th onClick={() => handleSort("corners_local_1t")} style={thStyle("corners_local_1t")} title="Ordenar por Corn Local">Local 1T <IconLocal />{flecha("corners_local_1t")}</th>
            <th onClick={() => handleSort("corners_visitante_1t")} style={thStyle("corners_visitante_1t")} title="Ordenar por Corn Visita">Visita 1T <IconVisita />{flecha("corners_visitante_1t")}</th>
            <th onClick={() => handleSort("corners_total_1t")} style={thStyle("corners_total_1t")} title="Ordenar por Corn Total">Total 1T{flecha("corners_total_1t")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>{r.liga}</td>
              <td>{numero(r.fecha_jornada)}</td>
              <td>{r.equipo_local}</td>
              <td>{r.equipo_visitante}</td>
              <td><span style={{ color: "inherit" }}><IconLocal /> {numero(r.goles_local_1t)}</span> - <span style={{ color: "inherit" }}><IconVisita /> {numero(r.goles_visitante_1t)}</span> <span className="tabla-muted">({numero(r.goles_total_1t)})</span></td>
              <td><span style={{ color: "inherit" }}><IconLocal /> {numero(r.goles_local_2t)}</span> - <span style={{ color: "inherit" }}><IconVisita /> {numero(r.goles_visitante_2t)}</span> <span className="tabla-muted">({numero(r.goles_total_2t)})</span></td>
              <td>{numero(r.goles_total)}</td>
              <td><span style={{ color: "inherit" }}><IconLocal style={{ marginRight: 4 }} />{numero(r.remates_local_1t)}</span></td>
              <td><span style={{ color: "inherit" }}><IconVisita style={{ marginRight: 4 }} />{numero(r.remates_visitante_1t)}</span></td>
              <td>{numero(r.remates_total_1t)}</td>
              <td><span style={{ color: "inherit" }}><IconLocal style={{ marginRight: 4 }} />{numero(r.corners_local_1t)}</span></td>
              <td><span style={{ color: "inherit" }}><IconVisita style={{ marginRight: 4 }} />{numero(r.corners_visitante_1t)}</span></td>
              <td>{numero(r.corners_total_1t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tabla-status"><span style={{ color: "inherit" }}><IconLocal /> Local (casa)</span> · <span style={{ color: "inherit" }}><IconVisita /> Visita (avión)</span> · Click en encabezado para ordenar (↕→↑↓) · Hover para ver 2T · {sort.key ? `Orden: ${sort.key} ${sort.dir}` : "Orden defecto: corners 1T ↓"}</p>
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

  const thStyleExp = (key) => ({
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    background: sort.key === key ? "var(--color-accent, #eef)" : undefined,
  })

  if (!resultados?.length) return null

  const renderLabel = (c) => (
    <>
      {c.label}
      {c.icon === "local" && <IconLocal style={{ marginLeft: 4 }} />}
      {c.icon === "visita" && <IconVisita style={{ marginLeft: 4 }} />}
      {flecha(c.key)}
    </>
  )

  const Cell = ({ icon, value }) => (
    <span style={{ color: "inherit", display: "inline-flex", alignItems: "center", gap: 4 }}>
      {icon === "local" && <IconLocal />}
      {icon === "visita" && <IconVisita />}
      {numero(value)}
    </span>
  )

  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            {COLUMNAS_EXPANDIDA.map((c) => (
              <th
                key={c.key}
                onClick={() => handleSort(c.key)}
                title={`Click para ordenar por ${c.label} (Excel)`}
                style={thStyleExp(c.key)}
              >
                {renderLabel(c)}
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
              <td><Cell icon="local" value={r.goles_local_1t} /></td>
              <td><Cell icon="visita" value={r.goles_visitante_1t} /></td>
              <td>{numero(r.goles_total_1t)}</td>
              <td><Cell icon="local" value={r.goles_local_2t} /></td>
              <td><Cell icon="visita" value={r.goles_visitante_2t} /></td>
              <td>{numero(r.goles_total_2t)}</td>
              <td><Cell icon="local" value={r.remates_local_1t} /></td>
              <td><Cell icon="visita" value={r.remates_visitante_1t} /></td>
              <td>{numero(r.remates_total_1t)}</td>
              <td><Cell icon="local" value={r.remates_local_2t} /></td>
              <td><Cell icon="visita" value={r.remates_visitante_2t} /></td>
              <td>{numero(r.remates_total_2t)}</td>
              <td><Cell icon="local" value={r.corners_local_1t} /></td>
              <td><Cell icon="visita" value={r.corners_visitante_1t} /></td>
              <td>{numero(r.corners_total_1t)}</td>
              <td><Cell icon="local" value={r.corners_local_2t} /></td>
              <td><Cell icon="visita" value={r.corners_visitante_2t} /></td>
              <td>{numero(r.corners_total_2t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tabla-status"><span style={{ color: "inherit" }}><IconLocal /> Local</span> · <span style={{ color: "inherit" }}><IconVisita /> Visita</span> · Click en encabezado para ordenar A-Z / menor-mayor. Orden actual: {sort.key ? `${sort.key} ${sort.dir === "asc" ? "↑" : "↓"}` : "por defecto (corners 1T ↓)"}</p>
    </div>
  )
}
