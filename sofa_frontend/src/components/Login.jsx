import { useState } from "react"
import axios from "axios"

// Login + registro (el registro queda PENDIENTE hasta aprobación del admin).
export const Login = ({ onSesion }) => {
  const [modo, setModo] = useState("login")
  const [usuario, setUsuario] = useState("")
  const [password, setPassword] = useState("")
  const [mensaje, setMensaje] = useState(null)
  const [cargando, setCargando] = useState(false)

  const cambiarModo = (m) => {
    setModo(m)
    setMensaje(null)
  }

  const enviar = async (e) => {
    e.preventDefault()
    if (cargando) return
    setCargando(true)
    setMensaje(null)
    try {
      if (modo === "login") {
        const r = await axios.post("/api/auth/login", { usuario, password })
        onSesion(r.data.usuario)
      } else {
        const r = await axios.post("/api/auth/registro", { usuario, password })
        setMensaje({ tipo: "ok", texto: r.data.message })
        setModo("login")
        setPassword("")
      }
    } catch (err) {
      setMensaje({
        tipo: "error",
        texto: err.response?.data?.message || "Error de conexión con el servidor.",
      })
    } finally {
      setCargando(false)
    }
  }

  return (
    <section className="login-vista">
      <h2 className="view-title">Analytics — acceso</h2>

      <div className="tabs">
        <button
          className={`tab ${modo === "login" ? "tab-active" : ""}`}
          onClick={() => cambiarModo("login")}
          type="button"
        >
          Entrar
        </button>
        <button
          className={`tab ${modo === "registro" ? "tab-active" : ""}`}
          onClick={() => cambiarModo("registro")}
          type="button"
        >
          Crear cuenta
        </button>
      </div>

      <section className="card">
        <div className="card-header">
          {modo === "login" ? "Iniciar sesión" : "Registro (queda pendiente de aprobación)"}
        </div>
        <form onSubmit={enviar}>
          <label className="field">
            <span className="field-label">Usuario o email</span>
            <input
              className="field-input"
              type="text"
              autoComplete="username"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Contraseña (mínimo 8 caracteres)</span>
            <input
              className="field-input"
              type="password"
              autoComplete={modo === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {mensaje && (
            <p className={`tabla-status ${mensaje.tipo === "error" ? "tabla-status-error" : ""}`}>
              {mensaje.texto}
            </p>
          )}

          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={cargando}>
              {cargando
                ? "Enviando..."
                : modo === "login"
                  ? "Entrar"
                  : "Crear cuenta"}
            </button>
          </div>
        </form>

        {modo === "login" && (
          <ul className="explicacion">
            <li>Sin cuenta: pestaña "Crear cuenta" — el admin (tú) la aprueba desde Usuarios y acceso.</li>
          </ul>
        )}
      </section>
    </section>
  )
}
