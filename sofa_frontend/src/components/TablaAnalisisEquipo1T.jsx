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
// Backgrounds por estadística (dark theme)
const BG = {
  goles: { th: "rgba(239,68,68,0.22)", td: "rgba(239,68,68,0.07)", border: "rgba(239,68,68,0.35)" },
  remates: { th: "rgba(56,189,248,0.22)", td: "rgba(56,189,248,0.07)", border: "rgba(56,189,248,0.35)" },
  corners: { th: "rgba(34,197,94,0.22)", td: "rgba(34,197,94,0.07)", border: "rgba(34,197,94,0.35)" },
  info: { th: "rgba(255,255,255,0.04)", td: "transparent", border: "transparent" },
}
const grupoDe = (key) => {
  if (key.startsWith("goles")) return "goles"
  if (key.startsWith("remates")) return "remates"
  if (key.startsWith("corners")) return "corners"
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
  { key: "equipo_local", label: "Local", type: "string", icon: "local", grupo: "info" },
  { key: "equipo_visitante", label: "Visitante", type: "string", icon: "visita", grupo: "info" },
  { key: "goles_local_1t", label: "Goles L 1T", type: "number", icon: "local", grupo: "goles" },
  { key: "goles_visitante_1t", label: "Goles V 1T", type: "number", icon: "visita", grupo: "goles" },
  { key: "goles_total_1t", label: "Total 1T", type: "number", grupo: "goles" },
  { key: "goles_local_2t", label: "Goles L 2T", type: "number", icon: "local", grupo: "goles" },
  { key: "goles_visitante_2t", label: "Goles V 2T", type: "number", icon: "visita", grupo: "goles" },
  { key: "goles_total_2t", label: "Total 2T", type: "number", grupo: "goles" },
  { key: "remates_local_1t", label: "Rem L 1T", type: "number", icon: "local", grupo: "remates" },
  { key: "remates_visitante_1t", label: "Rem V 1T", type: "number", icon: "visita", grupo: "remates" },
  { key: "remates_total_1t", label: "Rem Total 1T", type: "number", grupo: "remates" },
  { key: "remates_local_2t", label: "Rem L 2T", type: "number", icon: "local", grupo: "remates" },
  { key: "remates_visitante_2t", label: "Rem V 2T", type: "number", icon: "visita", grupo: "remates" },
  { key: "remates_total_2t", label: "Rem Total 2T", type: "number", grupo: "remates" },
  { key: "corners_local_1t", label: "Corn L 1T", type: "number", icon: "local", grupo: "corners" },
  { key: "corners_visitante_1t", label: "Corn V 1T", type: "number", icon: "visita", grupo: "corners" },
  { key: "corners_total_1t", label: "Corn Total 1T", type: "number", grupo: "corners" },
  { key: "corners_local_2t", label: "Corn L 2T", type: "number", icon: "local", grupo: "corners" },
  { key: "corners_visitante_2t", label: "Corn V 2T", type: "number", icon: "visita", grupo: "corners" },
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
            <th colSpan={3} style={{ background: BG.goles.th, borderBottom: `2px solid ${BG.goles.border}`, textAlign: "center" }}>Goles</th>
            <th colSpan={3} style={{ background: BG.remates.th, borderBottom: `2px solid ${BG.remates.border}`, textAlign: "center" }}>Remates</th>
            <th colSpan={3} style={{ background: BG.corners.th, borderBottom: `2px solid ${BG.corners.border}`, textAlign: "center" }}>Corners</th>
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
              <td style={tdStyle("info")}>{r.liga}</td>
              <td style={tdStyle("info")}>{numero(r.fecha_jornada)}</td>
              <td style={tdStyle("info")}>{r.equipo_local}</td>
              <td style={tdStyle("info")}>{r.equipo_visitante}</td>
              <td style={tdStyle("goles_total_1t")}><span style={{ color: "inherit" }}><IconLocal /> {numero(r.goles_local_1t)}</span> - <span style={{ color: "inherit" }}><IconVisita /> {numero(r.goles_visitante_1t)}</span> <span className="tabla-muted">({numero(r.goles_total_1t)})</span></td>
              <td style={tdStyle("goles_total_2t")}><span style={{ color: "inherit" }}><IconLocal /> {numero(r.goles_local_2t)}</span> - <span style={{ color: "inherit" }}><IconVisita /> {numero(r.goles_visitante_2t)}</span> <span className="tabla-muted">({numero(r.goles_total_2t)})</span></td>
              <td style={tdStyle("goles_total")}>{numero(r.goles_total)}</td>
              <td style={tdStyle("remates_local_1t")}><span style={{ color: "inherit" }}><IconLocal style={{ marginRight: 4 }} />{numero(r.remates_local_1t)}</span></td>
              <td style={tdStyle("remates_visitante_1t")}><span style={{ color: "inherit" }}><IconVisita style={{ marginRight: 4 }} />{numero(r.remates_visitante_1t)}</span></td>
              <td style={tdStyle("remates_total_1t")}>{numero(r.remates_total_1t)}</td>
              <td style={tdStyle("corners_local_1t")}><span style={{ color: "inherit" }}><IconLocal style={{ marginRight: 4 }} />{numero(r.corners_local_1t)}</span></td>
              <td style={tdStyle("corners_visitante_1t")}><span style={{ color: "inherit" }}><IconVisita style={{ marginRight: 4 }} />{numero(r.corners_visitante_1t)}</span></td>
              <td style={tdStyle("corners_total_1t")}>{numero(r.corners_total_1t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tabla-status" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconLocal /> Local (casa)</span> · <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconVisita /> Visita</span> ·
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.goles.th, border: `1px solid ${BG.goles.border}`, borderRadius: 2, display: "inline-block" }} /> Goles</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.remates.th, border: `1px solid ${BG.remates.border}`, borderRadius: 2, display: "inline-block" }} /> Remates</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.corners.th, border: `1px solid ${BG.corners.border}`, borderRadius: 2, display: "inline-block" }} /> Corners</span>
        · <span style={FONT_T1}>1T fino</span> / <span style={FONT_T2}>2T trazo mayor</span> · Click encabezado para ordenar (↕→↑↓) · {sort.key ? `Orden: ${sort.key} ${sort.dir}` : "Orden defecto: corners 1T ↓"}
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
              <td style={tdStyleExp("liga")}>{r.liga}</td>
              <td style={tdStyleExp("fecha_jornada")}>{numero(r.fecha_jornada)}</td>
              <td style={tdStyleExp("equipo_local")}>{r.equipo_local}</td>
              <td style={tdStyleExp("equipo_visitante")}>{r.equipo_visitante}</td>
              <td style={tdStyleExp("goles_local_1t")}><Cell icon="local" value={r.goles_local_1t} /></td>
              <td style={tdStyleExp("goles_visitante_1t")}><Cell icon="visita" value={r.goles_visitante_1t} /></td>
              <td style={tdStyleExp("goles_total_1t")}>{numero(r.goles_total_1t)}</td>
              <td style={tdStyleExp("goles_local_2t")}><Cell icon="local" value={r.goles_local_2t} /></td>
              <td style={tdStyleExp("goles_visitante_2t")}><Cell icon="visita" value={r.goles_visitante_2t} /></td>
              <td style={tdStyleExp("goles_total_2t")}>{numero(r.goles_total_2t)}</td>
              <td style={tdStyleExp("remates_local_1t")}><Cell icon="local" value={r.remates_local_1t} /></td>
              <td style={tdStyleExp("remates_visitante_1t")}><Cell icon="visita" value={r.remates_visitante_1t} /></td>
              <td style={tdStyleExp("remates_total_1t")}>{numero(r.remates_total_1t)}</td>
              <td style={tdStyleExp("remates_local_2t")}><Cell icon="local" value={r.remates_local_2t} /></td>
              <td style={tdStyleExp("remates_visitante_2t")}><Cell icon="visita" value={r.remates_visitante_2t} /></td>
              <td style={tdStyleExp("remates_total_2t")}>{numero(r.remates_total_2t)}</td>
              <td style={tdStyleExp("corners_local_1t")}><Cell icon="local" value={r.corners_local_1t} /></td>
              <td style={tdStyleExp("corners_visitante_1t")}><Cell icon="visita" value={r.corners_visitante_1t} /></td>
              <td style={tdStyleExp("corners_total_1t")}>{numero(r.corners_total_1t)}</td>
              <td style={tdStyleExp("corners_local_2t")}><Cell icon="local" value={r.corners_local_2t} /></td>
              <td style={tdStyleExp("corners_visitante_2t")}><Cell icon="visita" value={r.corners_visitante_2t} /></td>
              <td style={tdStyleExp("corners_total_2t")}>{numero(r.corners_total_2t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tabla-status" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconLocal /> Local</span> · <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconVisita /> Visita</span> ·
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.goles.th, border: `1px solid ${BG.goles.border}`, borderRadius: 2, display: "inline-block" }} /> Goles</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.remates.th, border: `1px solid ${BG.remates.border}`, borderRadius: 2, display: "inline-block" }} /> Remates</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, background: BG.corners.th, border: `1px solid ${BG.corners.border}`, borderRadius: 2, display: "inline-block" }} /> Corners</span>
        · <span style={FONT_T1}>1T fino</span> / <span style={FONT_T2}>2T trazo mayor</span> · Click encabezado para ordenar · {sort.key ? `Orden: ${sort.key} ${sort.dir === "asc" ? "↑" : "↓"}` : "Defecto: corners 1T ↓"}
      </p>
    </div>
  )
}
