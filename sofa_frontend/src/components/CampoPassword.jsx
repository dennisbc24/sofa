import { useState } from "react"

// Campo de contraseña con botón Ver/Ocultar a la derecha.
// `compacto` lo deja sin etiqueta (para usos en línea como "Poner contraseña").
export const CampoPassword = ({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
  disabled,
  compacto = false,
}) => {
  const [visible, setVisible] = useState(false)

  const input = (
    <input
      className="field-input"
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )

  const toggle = (
    <button
      type="button"
      className="password-toggle btn-link"
      onClick={() => setVisible((v) => !v)}
      aria-label={visible ? "Ocultar contraseña" : "Ver contraseña"}
      aria-pressed={visible}
      tabIndex={-1}
    >
      {visible ? "Ocultar" : "Ver"}
    </button>
  )

  if (compacto) {
    return (
      <span className="password-wrap password-wrap-compacto">
        {input}
        {toggle}
      </span>
    )
  }

  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <span className="password-wrap">
        {input}
        {toggle}
      </span>
    </label>
  )
}
