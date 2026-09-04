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
const IconEquipoX = ({ size = 13, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ verticalAlign: "middle", ...style }}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
)
// Backgrounds por estadística (dark theme)
const BG = {
  goles: { th: "rgba(239,68,68,0.22)", td: "rgba(239,68,68,0.07)", border: "rgba(239,68,68,0.35)" },
  remates: { th: "rgba(56,189,248,0.22)", td: "rgba(56,189,248,0.07)", border: "rgba(56,189,248,0.35)" },
  corners: { th: "rgba(34,197,94,0.22)", td: "rgba(34,197,94,0.07)", border: "rgba(34,197,94,0.35)" },
  info: { th: "rgba(255,255,255,0.04)", td: "transparent", border: "transparent" },
  equipoX: { th: "rgba(168,85,247,0.22)", td: "rgba(168,85,247,0.07)", border: "rgba(168,85,247,0.35)" },
  equipoY: { th: "rgba(255,255,255,0.06)", td: "transparent", border: "rgba(255,255,255,0.12)" },
}
const grupoDe = (key) => {
  if (key.startsWith("goles")) return "goles"
  if (key.startsWith("remates")) return "remates"
  if (key.startsWith("corners")) return "corners"
  if (key.startsWith("equipo_x") || key === "condicion_x") return "equipoX"
  if (key.startsWith("equipo_y")) return "equipoY"
  return "info"
}
// Fuente diferenciada T1 vs T2 (trazo mayor para 2T)
const FONT_T1 = { fontWeight: 400, fontSize: "0.85rem", fontStyle: "normal", opacity: 0.92 }
const FONT_T2 = { fontWeight: 700, fontSize: "0.95rem", letterSpacing: "0.3px", textShadow: "0 0 0.5px currentColor" }
const estiloPeriodo = (key) => {
  if (key.endsWith("_1t")) return FONT_T1
  if (key.endsWith("_2t")) return FONT_T2
  if (key === "goles_total") return { ...FONT_T2, fontSize: "0.96rem" }
  return {}
}
const COLUMNAS_EXPANDIDA = [
  { key: "liga", label: "Liga", type: "string", grupo: "info" },
  { key: "fecha_jornada", label: "Jornada", type: "number", grupo: "info" },
  { key: "equipo_x", label: "Equipo X", type: "string", grupo: "equipoX" },
  { key: "equipo_y", label: "Equipo Y", type: "string", grupo: "equipoY" },
  { key: "condicion_x", label: "Cond.", type: "string", grupo: "equipoX" },
  { key: "goles_x_1t", label: "Goles X 1T", type: "number", grupo: "goles" },
  { key: "goles_y_1t", label: "Goles Y 1T", type: "number", grupo: "goles" },
  { key: "goles_total_1t", label: "Total 1T", type: "number", grupo: "goles" },
  { key: "goles_x_2t", label: "Goles X 2T", type: "number", grupo: "goles" },
  { key: "goles_y_2t", label: "Goles Y 2T", type: "number", grupo: "goles" },
  { key: "goles_total_2t", label: "Total 2T", type: "number", grupo: "goles" },
  { key: "remates_x_1t", label: "Rem X 1T", type: "number", grupo: "remates" },
  { key: "remates_y_1t", label: "Rem Y 1T", type: "number", grupo: "remates" },
  { key: "remates_total_1t", label: "Rem Total 1T", type: "number", grupo: "remates" },
  { key: "remates_x_2t", label: "Rem X 2T", type: "number", grupo: "remates" },
  { key: "remates_y_2t", label: "Rem Y 2T", type: "number", grupo: "remates" },
  { key: "remates_total_2t", label: "Rem Total 2T", type: "number", grupo: "remates" },
  { key: "corners_x_1t", label: "Corn X 1T", type: "number", grupo: "corners" },
  { key: "corners_y_1t", label: "Corn Y 1T", type: "number", grupo: "corners" },
  { key: "corners_total_1t", label: "Corn Total 1T", type: "number", grupo: "corners" },
  { key: "corners_x_2t", label: "Corn X 2T", type: "number", grupo: "corners" },
  { key: "corners_y_2t", label: "Corn Y 2T", type: "number", grupo: "corners" },
  { key: "corners_total_2t", label: "Corn Total 2T", type: "number", grupo: "corners" },
]

export const TablaAnalisisEquipo1T = ({ resultados }) => {
  const [sort, setSort] = useState({ key: null, dir: "asc" })

  const handleSort = (key) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))
  }

  const flecha = (key) => (sort.key !== key ? " ↕" : sort.dir === "asc" ? " ↑" : " ↓")

  const thStyle = (key) => {
    const g = grupoDe(key)
    const base = BG[g].th
    const sortedBg = "rgba(var(--accent-rgb), 0.32)"
    return {
      cursor: "pointer",
      userSelect: "none",
      whiteSpace: "nowrap",
      background: sort.key === key ? sortedBg : base,
      borderBottom: `2px solid ${BG[g].border}`,
      ...estiloPeriodo(key),
    }
  }
  const tdStyle = (keyOrGrupo) => {
    const grupo = BG[keyOrGrupo] ? keyOrGrupo : grupoDe(keyOrGrupo)
    return {
      background: BG[grupo].td,
      ...estiloPeriodo(keyOrGrupo),
    }
  }

  const sorted = useMemo(() => {
    if (!resultados?.length) return []
    if (!sort.key) return resultados
    const dir = sort.dir === "asc" ? 1 : -1
    const isNum = ["fecha_jornada", "goles_x_1t", "goles_y_1t", "goles_total_1t", "goles_x_2t", "goles_y_2t", "goles_total_2t", "goles_total", "remates_x_1t", "remates_y_1t", "remates_total_1t", "corners_x_1t", "corners_y_1t", "corners_total_1t"].includes(sort.key)
    return [...resultados].sort((a, b) => {
      const va = a[sort.key] ?? a[sort.key.replace("_x_", "_local_").replace("_y_", "_visitante_")]
      const vb = b[sort.key] ?? b[sort.key.replace("_x_", "_local_").replace("_y_", "_visitante_")]
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
            <th rowSpan={2} onClick={() => handleSort("equipo_x")} style={{ ...thStyle("equipo_x"), fontWeight: 700 }} title="Equipo X (consultado)">Equipo X <IconEquipoX />{flecha("equipo_x")}</th>
            <th rowSpan={2} onClick={() => handleSort("equipo_y")} style={thStyle("equipo_y")} title="Equipo Y (rival)">Equipo Y{flecha("equipo_y")}</th>
            <th rowSpan={2} onClick={() => handleSort("condicion_x")} style={thStyle("condicion_x")} title="Condición de Equipo X">Cond.{flecha("condicion_x")}</th>
            <th colSpan={3} style={{ background: BG.goles.th, borderBottom: `2px solid ${BG.goles.border}`, textAlign: "center" }}>Goles</th>
            <th colSpan={3} style={{ background: BG.remates.th, borderBottom: `2px solid ${BG.remates.border}`, textAlign: "center" }}>Remates</th>
            <th colSpan={3} style={{ background: BG.corners.th, borderBottom: `2px solid ${BG.corners.border}`, textAlign: "center" }}>Corners</th>
          </tr>
          <tr>
            <th onClick={() => handleSort("goles_x_1t")} style={thStyle("goles_x_1t")} title="Goles Equipo X 1T">X 1T <IconEquipoX />{flecha("goles_x_1t")}</th>
            <th onClick={() => handleSort("goles_y_1t")} style={thStyle("goles_y_1t")} title="Goles Rival 1T">Y 1T{flecha("goles_y_1t")}</th>
            <th onClick={() => handleSort("goles_total_1t")} style={thStyle("goles_total_1t")} title="Total 1T">Total 1T{flecha("goles_total_1t")}</th>
            <th onClick={() => handleSort("remates_x_1t")} style={thStyle("remates_x_1t")} title="Remates X 1T">X 1T <IconEquipoX />{flecha("remates_x_1t")}</th>
            <th onClick={() => handleSort("remates_y_1t")} style={thStyle("remates_y_1t")} title="Remates Y 1T">Y 1T{flecha("remates_y_1t")}</th>
            <th onClick={() => handleSort("remates_total_1t")} style={thStyle("remates_total_1t")} title="Remates Total">Total 1T{flecha("remates_total_1t")}</th>
            <th onClick={() => handleSort("corners_x_1t")} style={thStyle("corners_x_1t")} title="Corners X 1T">X 1T <IconEquipoX />{flecha("corners_x_1t")}</th>
            <th onClick={() => handleSort("corners_y_1t")} style={thStyle("corners_y_1t")} title="Corners Y 1T">Y 1T{flecha("corners_y_1t")}</th>
            <th onClick={() => handleSort("corners_total_1t")} style={thStyle("corners_total_1t")} title="Corners Total">Total 1T{flecha("corners_total_1t")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const equipoX = r.equipo_x || r.equipo_local
            const equipoY = r.equipo_y || r.equipo_visitante
            const cond = r.condicion_x || (r.es_local_x ? "Local" : r.es_local_x === false ? "Visita" : (r.equipo_local === equipoX ? "Local" : "Visita"))
            const esLocal = cond === "Local"
            const golesX1 = r.goles_x_1t ?? r.goles_local_1t
            const golesY1 = r.goles_y_1t ?? r.goles_visitante_1t
            const remX1 = r.remates_x_1t ?? r.remates_local_1t
            const remY1 = r.remates_y_1t ?? r.remates_visitante_1t
            const cornX1 = r.corners_x_1t ?? r.corners_local_1t
            const cornY1 = r.corners_y_1t ?? r.corners_visitante_1t
            return (
              <tr key={r.id}>
                <td style={tdStyle("info")}>{r.liga}</td>
                <td style={tdStyle("info")}>{numero(r.fecha_jornada)}</td>
                <td style={{ ...tdStyle("equipoX"), fontWeight: 700 }}>{equipoX}</td>
                <td style={tdStyle("equipoY")}>{equipoY}</td>
                <td style={tdStyle("equipoX")} title={esLocal ? "Equipo X fue Local" : "Equipo X fue Visita"}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "inherit" }}>
                    {esLocal ? <IconLocal /> : <IconVisita />} {cond}
                  </span>
                </td>
                <td style={tdStyle("goles_x_1t")}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconEquipoX /> {numero(golesX1)}</span></td>
                <td style={tdStyle("goles_y_1t")}>{numero(golesY1)}</td>
                <td style={tdStyle("goles_total_1t")}>{numero(r.goles_total_1t)}</td>
                <td style={tdStyle("remates_x_1t")}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconEquipoX /> {numero(remX1)}</span></td>
                <td style={tdStyle("remates_y_1t")}>{numero(remY1)}</td>
                <td style={tdStyle("remates_total_1t")}>{numero(r.remates_total_1t ?? r.remates_total_1t)}</td>
                <td style={tdStyle("corners_x_1t")}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconEquipoX /> {numero(cornX1)}</span></td>
                <td style={tdStyle("corners_y_1t")}>{numero(cornY1)}</td>
                <td style={tdStyle("corners_total_1t")}>{numero(r.corners_total_1t)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="tabla-status" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconEquipoX /> Equipo X (consultado)</span> · <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconLocal /> Local</span> <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconVisita /> Visita</span> (condición de X) ·
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.goles.th, border: `1px solid ${BG.goles.border}`, borderRadius: 2, display: "inline-block" }} /> Goles</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.remates.th, border: `1px solid ${BG.remates.border}`, borderRadius: 2, display: "inline-block" }} /> Remates</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.corners.th, border: `1px solid ${BG.corners.border}`, borderRadius: 2, display: "inline-block" }} /> Corners</span>
        · <span style={FONT_T1}>1T</span> / <span style={FONT_T2}>2T</span> · Click encabezado para ordenar · {sort.key ? `Orden: ${sort.key} ${sort.dir}` : "Orden defecto: corners 1T ↓"}
      </p>
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
      const va = a[sort.key] ?? a[sort.key.replace("_x_", "_local_").replace("_y_", "_visitante_").replace("condicion_x", "es_local_x")]
      const vb = b[sort.key] ?? b[sort.key.replace("_x_", "_local_").replace("_y_", "_visitante_").replace("condicion_x", "es_local_x")]
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

  const thStyleExp = (key) => {
    const col = COLUMNAS_EXPANDIDA.find((c) => c.key === key)
    const grupo = col?.grupo || grupoDe(key)
    const base = BG[grupo].th
    const sortedBg = "rgba(var(--accent-rgb), 0.30)"
    return {
      cursor: "pointer",
      userSelect: "none",
      whiteSpace: "nowrap",
      background: sort.key === key ? sortedBg : base,
      borderBottom: `2px solid ${BG[grupo].border}`,
      ...estiloPeriodo(key),
    }
  }
  const tdStyleExp = (key) => {
    const col = COLUMNAS_EXPANDIDA.find((c) => c.key === key)
    const grupo = col?.grupo || grupoDe(key)
    return { background: BG[grupo].td, ...estiloPeriodo(key) }
  }

  if (!resultados?.length) return null

  const renderLabel = (c) => (
    <>
      {c.label}
      {c.key === "equipo_x" && <IconEquipoX style={{ marginLeft: 4 }} />}
      {c.key === "condicion_x" && <IconLocal style={{ marginLeft: 4 }} />}
      {c.icon === "local" && c.key !== "equipo_x" && <IconLocal style={{ marginLeft: 4 }} />}
      {c.icon === "visita" && <IconVisita style={{ marginLeft: 4 }} />}
      {flecha(c.key)}
    </>
  )

  const Cell = ({ icon, value }) => (
    <span style={{ color: "inherit", display: "inline-flex", alignItems: "center", gap: 4 }}>
      {icon === "local" && <IconLocal />}
      {icon === "visita" && <IconVisita />}
      {icon === "equipoX" && <IconEquipoX />}
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
          {sorted.map((r) => {
            const equipoX = r.equipo_x || r.equipo_local
            const equipoY = r.equipo_y || r.equipo_visitante
            const cond = r.condicion_x || (r.es_local_x ? "Local" : r.es_local_x === false ? "Visita" : "")
            return (
              <tr key={r.id}>
                <td style={tdStyleExp("liga")}>{r.liga}</td>
                <td style={tdStyleExp("fecha_jornada")}>{numero(r.fecha_jornada)}</td>
                <td style={{ ...tdStyleExp("equipo_x"), fontWeight: 700 }}>{equipoX}</td>
                <td style={tdStyleExp("equipo_y")}>{equipoY}</td>
                <td style={tdStyleExp("condicion_x")}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{cond === "Local" ? <IconLocal /> : <IconVisita />} {cond}</span></td>
                <td style={tdStyleExp("goles_x_1t")}><Cell icon="equipoX" value={r.goles_x_1t ?? r.goles_local_1t} /></td>
                <td style={tdStyleExp("goles_y_1t")}>{numero(r.goles_y_1t ?? r.goles_visitante_1t)}</td>
                <td style={tdStyleExp("goles_total_1t")}>{numero(r.goles_total_1t)}</td>
                <td style={tdStyleExp("goles_x_2t")}><Cell icon="equipoX" value={r.goles_x_2t ?? r.goles_local_2t} /></td>
                <td style={tdStyleExp("goles_y_2t")}>{numero(r.goles_y_2t ?? r.goles_visitante_2t)}</td>
                <td style={tdStyleExp("goles_total_2t")}>{numero(r.goles_total_2t)}</td>
                <td style={tdStyleExp("remates_x_1t")}><Cell icon="equipoX" value={r.remates_x_1t ?? r.remates_local_1t} /></td>
                <td style={tdStyleExp("remates_y_1t")}>{numero(r.remates_y_1t ?? r.remates_visitante_1t)}</td>
                <td style={tdStyleExp("remates_total_1t")}>{numero(r.remates_total_1t)}</td>
                <td style={tdStyleExp("remates_x_2t")}><Cell icon="equipoX" value={r.remates_x_2t ?? r.remates_local_2t} /></td>
                <td style={tdStyleExp("remates_y_2t")}>{numero(r.remates_y_2t ?? r.remates_visitante_2t)}</td>
                <td style={tdStyleExp("remates_total_2t")}>{numero(r.remates_total_2t)}</td>
                <td style={tdStyleExp("corners_x_1t")}><Cell icon="equipoX" value={r.corners_x_1t ?? r.corners_local_1t} /></td>
                <td style={tdStyleExp("corners_y_1t")}>{numero(r.corners_y_1t ?? r.corners_visitante_1t)}</td>
                <td style={tdStyleExp("corners_total_1t")}>{numero(r.corners_total_1t)}</td>
                <td style={tdStyleExp("corners_x_2t")}><Cell icon="equipoX" value={r.corners_x_2t ?? r.corners_local_2t} /></td>
                <td style={tdStyleExp("corners_y_2t")}>{numero(r.corners_y_2t ?? r.corners_visitante_2t)}</td>
                <td style={tdStyleExp("corners_total_2t")}>{numero(r.corners_total_2t)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="tabla-status" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconEquipoX /> Equipo X (consultado)</span> · <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconLocal /> Local</span> <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconVisita /> Visita</span> (condición X) ·
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.goles.th, border: `1px solid ${BG.goles.border}`, borderRadius: 2, display: "inline-block" }} /> Goles</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.remates.th, border: `1px solid ${BG.remates.border}`, borderRadius: 2, display: "inline-block" }} /> Remates</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.corners.th, border: `1px solid ${BG.corners.border}`, borderRadius: 2, display: "inline-block" }} /> Corners</span>
        · <span style={FONT_T1}>1T fino</span> / <span style={FONT_T2}>2T trazo mayor</span> · Click encabezado para ordenar · {sort.key ? `Orden: ${sort.key} ${sort.dir === "asc" ? "↑" : "↓"}` : "Defecto: corners 1T ↓"}
      </p>
    </div>
  )
}
