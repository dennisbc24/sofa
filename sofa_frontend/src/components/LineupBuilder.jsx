import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import axios from "axios"
import { API_URL } from "../config.js"

// ---------------------------------------------------------------------------
// LineupBuilder: constructor de alineaciones por arrastrar y soltar.
// - Todos los jugadores empiezan como SUPLENTES.
// - Se arrastran a una posicion del campo (titular) o a la zona de NO
//   DISPONIBLES (suspendido / lesionado).
// - Dos pestañas (local / visitante) y eleccion de formacion (posiciones
//   exactas en el campo, estilo FotMob).
// Devuelve la alineacion via onChange:
//   { local: { titulares, suplentes, suspendidos }, visitante: {...} }
// ---------------------------------------------------------------------------

// Formaciones con las coordenadas de cada puesto (x%, y%) en el campo.
// y = 0 es la linea de ataque (arriba), y = 100 la porteria (abajo).
const FORMACIONES = {
  "4-3-3": [
    { x: 50, y: 93, pos: "G" },
    { x: 12, y: 71, pos: "D" }, { x: 37, y: 76, pos: "D" }, { x: 63, y: 76, pos: "D" }, { x: 88, y: 71, pos: "D" },
    { x: 25, y: 50, pos: "M" }, { x: 50, y: 57, pos: "M" }, { x: 75, y: 50, pos: "M" },
    { x: 18, y: 23, pos: "F" }, { x: 50, y: 16, pos: "F" }, { x: 82, y: 23, pos: "F" },
  ],
  "4-2-3-1": [
    { x: 50, y: 93, pos: "G" },
    { x: 12, y: 71, pos: "D" }, { x: 37, y: 76, pos: "D" }, { x: 63, y: 76, pos: "D" }, { x: 88, y: 71, pos: "D" },
    { x: 35, y: 58, pos: "M" }, { x: 65, y: 58, pos: "M" },
    { x: 18, y: 37, pos: "M" }, { x: 50, y: 33, pos: "M" }, { x: 82, y: 37, pos: "M" },
    { x: 50, y: 14, pos: "F" },
  ],
  "4-4-2": [
    { x: 50, y: 93, pos: "G" },
    { x: 12, y: 71, pos: "D" }, { x: 37, y: 76, pos: "D" }, { x: 63, y: 76, pos: "D" }, { x: 88, y: 71, pos: "D" },
    { x: 14, y: 50, pos: "M" }, { x: 38, y: 54, pos: "M" }, { x: 62, y: 54, pos: "M" }, { x: 86, y: 50, pos: "M" },
    { x: 38, y: 20, pos: "F" }, { x: 62, y: 20, pos: "F" },
  ],
  "4-1-2-3": [
    { x: 50, y: 93, pos: "G" },
    { x: 12, y: 71, pos: "D" }, { x: 37, y: 76, pos: "D" }, { x: 63, y: 76, pos: "D" }, { x: 88, y: 71, pos: "D" },
    { x: 50, y: 62, pos: "M" },
    { x: 33, y: 45, pos: "M" }, { x: 67, y: 45, pos: "M" },
    { x: 18, y: 23, pos: "F" }, { x: 50, y: 16, pos: "F" }, { x: 82, y: 23, pos: "F" },
  ],
  "4-2-1-3": [
    { x: 50, y: 93, pos: "G" },
    { x: 12, y: 71, pos: "D" }, { x: 37, y: 76, pos: "D" }, { x: 63, y: 76, pos: "D" }, { x: 88, y: 71, pos: "D" },
    { x: 35, y: 58, pos: "M" }, { x: 65, y: 58, pos: "M" },
    { x: 50, y: 38, pos: "M" },
    { x: 18, y: 22, pos: "F" }, { x: 50, y: 15, pos: "F" }, { x: 82, y: 22, pos: "F" },
  ],
  "3-5-2": [
    { x: 50, y: 93, pos: "G" },
    { x: 18, y: 74, pos: "D" }, { x: 50, y: 78, pos: "D" }, { x: 82, y: 74, pos: "D" },
    { x: 11, y: 50, pos: "M" }, { x: 31, y: 57, pos: "M" }, { x: 50, y: 45, pos: "M" }, { x: 69, y: 57, pos: "M" }, { x: 89, y: 50, pos: "M" },
    { x: 38, y: 20, pos: "F" }, { x: 62, y: 20, pos: "F" },
  ],
  "3-4-3": [
    { x: 50, y: 93, pos: "G" },
    { x: 18, y: 74, pos: "D" }, { x: 50, y: 78, pos: "D" }, { x: 82, y: 74, pos: "D" },
    { x: 14, y: 50, pos: "M" }, { x: 38, y: 56, pos: "M" }, { x: 62, y: 56, pos: "M" }, { x: 86, y: 50, pos: "M" },
    { x: 18, y: 23, pos: "F" }, { x: 50, y: 16, pos: "F" }, { x: 82, y: 23, pos: "F" },
  ],
  "5-3-2": [
    { x: 50, y: 93, pos: "G" },
    { x: 10, y: 74, pos: "D" }, { x: 30, y: 79, pos: "D" }, { x: 50, y: 82, pos: "D" }, { x: 70, y: 79, pos: "D" }, { x: 90, y: 74, pos: "D" },
    { x: 25, y: 52, pos: "M" }, { x: 50, y: 57, pos: "M" }, { x: 75, y: 52, pos: "M" },
    { x: 38, y: 20, pos: "F" }, { x: 62, y: 20, pos: "F" },
  ],
  "4-5-1": [
    { x: 50, y: 93, pos: "G" },
    { x: 12, y: 71, pos: "D" }, { x: 37, y: 76, pos: "D" }, { x: 63, y: 76, pos: "D" }, { x: 88, y: 71, pos: "D" },
    { x: 14, y: 50, pos: "M" }, { x: 30, y: 56, pos: "M" }, { x: 50, y: 52, pos: "M" }, { x: 70, y: 56, pos: "M" }, { x: 86, y: 50, pos: "M" },
    { x: 50, y: 18, pos: "F" },
  ],
  "4-1-4-1": [
    { x: 50, y: 93, pos: "G" },
    { x: 12, y: 71, pos: "D" }, { x: 37, y: 76, pos: "D" }, { x: 63, y: 76, pos: "D" }, { x: 88, y: 71, pos: "D" },
    { x: 50, y: 63, pos: "M" },
    { x: 16, y: 48, pos: "M" }, { x: 38, y: 53, pos: "M" }, { x: 62, y: 53, pos: "M" }, { x: 84, y: 48, pos: "M" },
    { x: 50, y: 18, pos: "F" },
  ],
  "3-4-1-2": [
    { x: 50, y: 93, pos: "G" },
    { x: 18, y: 74, pos: "D" }, { x: 50, y: 78, pos: "D" }, { x: 82, y: 74, pos: "D" },
    { x: 14, y: 52, pos: "M" }, { x: 38, y: 56, pos: "M" }, { x: 62, y: 56, pos: "M" }, { x: 86, y: 52, pos: "M" },
    { x: 50, y: 38, pos: "M" },
    { x: 38, y: 20, pos: "F" }, { x: 62, y: 20, pos: "F" },
  ],
}

const ETIQUETA_POS = { G: "Portero", D: "Defensa", M: "Medio", F: "Ataque" }

// Coloca a los jugadores en los puestos de la formacion: primero el arquero
// (habitual o el de la ultima XI) y luego el resto por posicion.
const colocarXI = (datos, formacion) => {
  const slots = FORMACIONES[formacion] || FORMACIONES["4-3-3"]
  const p = {}
  const xi = datos.ultimaXI?.titulares || []
  // 1) Arquero: el de la ultima XI o, si no hay, el habitual del equipo.
  const gk = xi.find((j) => j.posicion === "G")
    || (datos.arqueroHabitual ? { ...datos.arqueroHabitual, posicion: "G" } : null)
  if (gk) {
    const i = slots.findIndex((s) => s.pos === "G")
    if (i !== -1) p[i] = gk.player_id
  }
  // 2) El resto de la ultima XI, por posicion.
  for (const j of xi) {
    if (j.posicion === "G") continue
    const i = slots.findIndex((s, k) => !p[k] && s.pos === j.posicion)
    if (i !== -1) p[i] = j.player_id
  }
  return p
}

// Arma el lado de la alineacion (titulares / suplentes / suspendidos).
const armarPayload = (puestos, suspendidos, jugadores) => {
  const tit = Object.values(puestos || {})
  const enTit = new Set(tit)
  const enSusp = new Set(suspendidos || [])
  return {
    titulares: tit,
    suplentes: (jugadores || []).map((j) => j.player_id).filter((id) => !enTit.has(id) && !enSusp.has(id)),
    suspendidos: suspendidos || [],
  }
}

export const LineupBuilder = ({ local, visita, onChange }) => {
  const [equipoActivo, setEquipoActivo] = useState("local")
  const [squads, setSquads] = useState({ local: [], visitante: [] })
  const [datosPorLado, setDatosPorLado] = useState({ local: null, visitante: null })
  const [formaciones, setFormaciones] = useState({ local: "4-3-3", visitante: "4-3-3" })
  const [puestos, setPuestos] = useState({ local: {}, visitante: {} })
  const [suspendidos, setSuspendidos] = useState({ local: [], visitante: [] })
  const [ultimasXI, setUltimasXI] = useState({ local: null, visitante: null })
  const [cargando, setCargando] = useState(false)
  const [menu, setMenu] = useState(null)
  const [busqueda, setBusqueda] = useState("")
  const [aviso, setAviso] = useState(null)
  // Marca que hubo un arrastre: evita que el clic residual quite al jugador.
  const arrastrando = useRef(false)

  const jugadores = squads[equipoActivo] || []
  const slots = FORMACIONES[formaciones[equipoActivo]] || FORMACIONES["4-3-3"]
  const misPuestos = puestos[equipoActivo] || {}
  const misSuspendidos = suspendidos[equipoActivo] || []

  const porId = useMemo(() => {
    const m = new Map()
    for (const j of jugadores) m.set(j.player_id, j)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squads, equipoActivo])

  const publicar = useCallback((puestosNuevo, suspNuevo) => {
    const payload = { local: {}, visitante: {} }
    for (const lado of ["local", "visitante"]) {
      const tit = Object.values(puestosNuevo[lado] || {})
      const susp = suspNuevo[lado] || []
      const todos = (squads[lado] || []).map((j) => j.player_id)
      const enTit = new Set(tit)
      const enSusp = new Set(susp)
      payload[lado] = {
        titulares: tit,
        suplentes: todos.filter((id) => !enTit.has(id) && !enSusp.has(id)),
        suspendidos: susp,
      }
    }
    if (onChange) onChange(payload)
  }, [onChange, squads])

  // Cargar squads e inicializar (todos suplentes).
  useEffect(() => {
    if (!local || !visita) return
    let vivo = true
    setCargando(true)
    Promise.all([
      axios.get(`${API_URL}/api/predictions/alineacion/${encodeURIComponent(local)}`),
      axios.get(`${API_URL}/api/predictions/alineacion/${encodeURIComponent(visita)}`),
    ]).then(([rl, rv]) => {
      if (!vivo) return
      setSquads({ local: rl.data.jugadores, visitante: rv.data.jugadores })
      setDatosPorLado({ local: rl.data, visitante: rv.data })
      const fL = rl.data.formacion?.forma && FORMACIONES[rl.data.formacion.forma]
        ? rl.data.formacion.forma : "4-3-3"
      const fV = rv.data.formacion?.forma && FORMACIONES[rv.data.formacion.forma]
        ? rv.data.formacion.forma : "4-3-3"
      setFormaciones({ local: fL, visitante: fV })
      setUltimasXI({ local: rl.data.ultimaXI || null, visitante: rv.data.ultimaXI || null })
      // Precarga: la ultima alineacion conocida + el arquero habitual.
      const puestos0 = {
        local: colocarXI(rl.data, fL),
        visitante: colocarXI(rv.data, fV),
      }
      const susp0 = { local: [], visitante: [] }
      setPuestos(puestos0)
      setSuspendidos(susp0)
      const payload = {
        local: armarPayload(puestos0.local, [], rl.data.jugadores),
        visitante: armarPayload(puestos0.visitante, [], rv.data.jugadores),
      }
      if (onChange) onChange(payload)
    }).catch(() => {}).finally(() => vivo && setCargando(false))
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, visita])

  // El puesto de portero solo admite porteros; y un portero solo va al
  // puesto de portero (evita meter un jugador de cancha en la porteria).
  const slotAcepta = (slot, jug) => {
    if (!jug) return false
    const esPortero = jug.posicion === "G"
    return esPortero ? slot.pos === "G" : slot.pos !== "G"
  }

  const avisar = (texto) => {
    setAviso(texto)
    setTimeout(() => setAviso(null), 2500)
  }

  // Asigna un jugador al primer hueco libre de su posicion (o al slot dado).
  const asignar = (pid, slotIdx = null) => {
    const jug = porId.get(pid)
    if (!jug) return
    if (slotIdx !== null) {
      const slot = slots[slotIdx]
      if (!slotAcepta(slot, jug)) {
        avisar(
          jug.posicion === "G"
            ? "Un portero solo puede ir en la portería."
            : `${jug.nombre} es ${ETIQUETA_POS[jug.posicion] || jug.posicion}: no puede ir en la portería.`
        )
        return
      }
    }
    setPuestos((prev) => {
      const nuevos = { ...prev, [equipoActivo]: { ...prev[equipoActivo] } }
      // Libera el slot que ocupaba.
      for (const k of Object.keys(nuevos[equipoActivo])) {
        if (nuevos[equipoActivo][k] === pid) delete nuevos[equipoActivo][k]
      }
      let destino = slotIdx
      if (destino === null || nuevos[equipoActivo][destino]) {
        destino = slots.findIndex((s, i) => !nuevos[equipoActivo][i] && s.pos === jug.posicion)
        if (destino === -1) {
          // Sin hueco de su posicion: cualquier hueco libre que NO sea la porteria.
          destino = slots.findIndex((s, i) => !nuevos[equipoActivo][i] && s.pos !== "G")
          if (destino === -1 && jug.posicion === "G") {
            destino = slots.findIndex((s, i) => !nuevos[equipoActivo][i] && s.pos === "G")
          }
        }
      }
      if (destino === -1) return prev
      nuevos[equipoActivo][destino] = pid
      // Si el jugador estaba suspendido, deja de estarlo.
      setSuspendidos((sp) => {
        const s2 = { ...sp, [equipoActivo]: (sp[equipoActivo] || []).filter((x) => x !== pid) }
        setTimeout(() => publicar(nuevos, s2), 0)
        return s2
      })
      return nuevos
    })
  }

  const quitar = (pid) => {
    // Sale del campo Y de la lista de no disponibles (vuelve al banquillo).
    setPuestos((prev) => {
      const nuevos = { ...prev, [equipoActivo]: { ...prev[equipoActivo] } }
      for (const k of Object.keys(nuevos[equipoActivo])) {
        if (nuevos[equipoActivo][k] === pid) delete nuevos[equipoActivo][k]
      }
      setSuspendidos((sp) => {
        const s2 = { ...sp, [equipoActivo]: (sp[equipoActivo] || []).filter((x) => x !== pid) }
        setTimeout(() => publicar(nuevos, s2), 0)
        return s2
      })
      return nuevos
    })
  }

  const marcarSuspendido = (pid) => {
    setSuspendidos((prev) => {
      const s2 = { ...prev, [equipoActivo]: [...new Set([...(prev[equipoActivo] || []), pid])] }
      const p2 = { ...puestos, [equipoActivo]: { ...puestos[equipoActivo] } }
      for (const k of Object.keys(p2[equipoActivo])) {
        if (p2[equipoActivo][k] === pid) delete p2[equipoActivo][k]
      }
      setPuestos(p2)
      setTimeout(() => publicar(p2, s2), 0)
      return s2
    })
  }

  const arrastrar = (e, pid) => {
    e.dataTransfer.setData("text/plain", pid)
    e.dataTransfer.effectAllowed = "move"
    arrastrando.current = true
    setTimeout(() => { arrastrando.current = false }, 250)
  }

  const menuContexto = (e, pid) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, pid })
  }

  const opcionMenu = (destino) => {
    const pid = menu.pid
    setMenu(null)
    if (destino === "titular") asignar(pid)
    else if (destino === "suplente") quitar(pid)
    else if (destino === "suspendido") marcarSuspendido(pid)
  }

  const zonaNombre = (pid) => {
    const enCampo = Object.values(misPuestos).includes(pid)
    if (enCampo) return "titular"
    if (misSuspendidos.includes(pid)) return "suspendido"
    return "suplente"
  }

  const chip = (j, estado, extra = {}) => (
    <div
      key={`${estado}-${j.player_id}`}
      className={`jugador-chip jugador-${estado}`}
      draggable
      onDragStart={(e) => arrastrar(e, j.player_id)}
      onContextMenu={(e) => menuContexto(e, j.player_id)}
      title={`${j.nombre} (${ETIQUETA_POS[j.posicion] || j.posicion}) — xG/90 ${j.xg_prom ?? "—"} · tiros/90 ${j.tiros_prom ?? "—"}`}
      {...extra}
    >
      <span className="jugador-dorsal">{j.dorsal ?? "—"}</span>
      <span className="jugador-nombre">{j.nombre}</span>
    </div>
  )

  const q = busqueda.trim().toLowerCase()
  const filtrar = (j) => !q || j.nombre.toLowerCase().includes(q) || String(j.dorsal ?? "").includes(q)

  return (
    <section className="lineup-builder">
      <div className="lineup-tabs">
        <button
          className={`lineup-tab ${equipoActivo === "local" ? "activo" : ""}`}
          onClick={() => setEquipoActivo("local")}
        >
          {local}
        </button>
        <button
          className={`lineup-tab ${equipoActivo === "visitante" ? "activo" : ""}`}
          onClick={() => setEquipoActivo("visitante")}
        >
          {visita}
        </button>
      </div>

      <div className="lineup-formacion">
        <span className="lineup-zona-etiqueta">Formación</span>
        <select
          className="lineup-select"
          value={formaciones[equipoActivo]}
          onChange={(e) => {
            const v = e.target.value
            const nuevos = { ...formaciones, [equipoActivo]: v }
            setFormaciones(nuevos)
            // Reacomoda los titulares a los puestos de la nueva formacion.
            setPuestos((prev) => {
              const p2 = { ...prev, [equipoActivo]: {} }
              const tit = Object.values(prev[equipoActivo] || {})
              const nuevosSlots = FORMACIONES[v] || []
              tit.forEach((pid) => {
                const jug = porId.get(pid)
                let destino = nuevosSlots.findIndex((s, k) => !p2[equipoActivo][k] && s.pos === (jug && jug.posicion))
                if (destino === -1) {
                  destino = nuevosSlots.findIndex((s, k) => !p2[equipoActivo][k] && s.pos !== "G")
                  if (destino === -1 && jug && jug.posicion === "G") {
                    destino = nuevosSlots.findIndex((s, k) => !p2[equipoActivo][k] && s.pos === "G")
                  }
                }
                if (destino !== -1) p2[equipoActivo][destino] = pid
              })
              setTimeout(() => publicar(p2, suspendidos), 0)
              return p2
            })
          }}
        >
          {Object.keys(FORMACIONES).map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <span className="lineup-contador-inline">
          Titulares: {Object.keys(misPuestos).length}/11
        </span>
      </div>

      {cargando && <p className="tabla-status">Cargando plantilla…</p>}
      {aviso && <p className="tabla-status tabla-status-error lineup-aviso">{aviso}</p>}
      {!cargando && ultimasXI?.[equipoActivo] && (
        <p className="tabla-status lineup-precarga">
          Precargado con la última alineación conocida ({ultimasXI[equipoActivo].fecha}) — modifícala o déjala
          tal cual.{" "}
          <button
            className="btn-link"
            onClick={() => {
              const f = formaciones[equipoActivo]
              const datos = datosPorLado[equipoActivo]
              if (!datos) return
              const nuevos = { ...puestos, [equipoActivo]: colocarXI(datos, f) }
              setPuestos(nuevos)
              setTimeout(() => publicar(nuevos, suspendidos), 0)
            }}
          >
            recargar
          </button>
        </p>
      )}

      {!cargando && (
        <>
          <div
            className="lineup-pitch"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const pid = e.dataTransfer.getData("text/plain")
              if (pid) asignar(pid)
            }}
          >
            {slots.map((slot, i) => {
              const pid = misPuestos[i]
              const jug = pid ? porId.get(pid) : null
              return (
                <div
                  key={i}
                  className={`lineup-slot lineup-slot-${slot.pos.toLowerCase()} ${jug ? "ocupado" : ""}`}
                  style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                  draggable={!!jug}
                  onDragStart={(e) => jug && arrastrar(e, jug.player_id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const pid2 = e.dataTransfer.getData("text/plain")
                    if (pid2) asignar(pid2, i)
                  }}
                  title={jug ? `${jug.nombre} — arrastra para moverlo de puesto, clic para quitarlo` : `Puesto de ${ETIQUETA_POS[slot.pos]}`}
                  onClick={() => {
                    if (arrastrando.current) return
                    if (pid) quitar(pid)
                  }}
                >
                  {jug ? (
                    <>
                      <span className="lineup-slot-dorsal">{jug.dorsal ?? "—"}</span>
                      <span className="lineup-slot-nombre">{jug.nombre}</span>
                    </>
                  ) : (
                    <span className="lineup-slot-vacio">{ETIQUETA_POS[slot.pos] || slot.pos}</span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="lineup-zonas">
            <div
              className="lineup-suspendidos"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const pid = e.dataTransfer.getData("text/plain")
                if (pid) marcarSuspendido(pid)
              }}
            >
              <span className="lineup-zona-etiqueta">No disponibles (lesionados / suspendidos)</span>
              <div className="lineup-zona-jugadores">
                {misSuspendidos.map((pid) => {
                  const j = porId.get(pid)
                  return j ? chip(j, "suspendido", {
                    onClick: () => quitar(pid),
                    title: `${j.nombre} — clic o arrastra para devolverlo a la plantilla`,
                  }) : null
                })}
                {misSuspendidos.length === 0 && <span className="lineup-vacio">Arrastra aquí</span>}
              </div>
            </div>

            <div
              className="lineup-plantilla"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const pid = e.dataTransfer.getData("text/plain")
                if (pid) quitar(pid)
              }}
            >
              <span className="lineup-zona-etiqueta">
                Banquillo / plantilla — {jugadores.filter((j) => zonaNombre(j.player_id) === "suplente").length}
              </span>
              <input
                className="lineup-busqueda"
                type="text"
                placeholder="Buscar jugador…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <div className="lineup-zona-jugadores">
                {jugadores.filter((j) => zonaNombre(j.player_id) === "suplente" && filtrar(j)).map((j) => chip(j, "suplente"))}
                {jugadores.filter((j) => zonaNombre(j.player_id) === "suplente" && filtrar(j)).length === 0 && (
                  <span className="lineup-vacio">Sin resultados</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {menu && (
        <>
          <div className="lineup-menu-backdrop" onClick={() => setMenu(null)} />
          <div className="lineup-menu" style={{ left: menu.x, top: menu.y }}>
            <button className="lineup-menu-op" onClick={() => opcionMenu("titular")}>Poner como titular</button>
            <button className="lineup-menu-op" onClick={() => opcionMenu("suplente")}>Poner como suplente</button>
            <button className="lineup-menu-op" onClick={() => opcionMenu("suspendido")}>Marcar como no disponible</button>
          </div>
        </>
      )}
    </section>
  )
}
