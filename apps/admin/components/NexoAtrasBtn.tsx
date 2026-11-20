"use client";

type NexoAtrasBtnProps = {
  onClick: () => void;
  /** Por defecto «Atras». */
  label?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Botón Atras del sistema (misma posición/tamaño en todas las pantallas).
 * Solo diseño: el onClick lo pone quien navega.
 */
export function NexoAtrasBtn({
  onClick,
  label = "Atras",
  className = "",
  disabled = false,
}: NexoAtrasBtnProps) {
  return (
    <button
      type="button"
      className={className ? `nexo-atras-btn ${className}` : "nexo-atras-btn"}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="nexo-atras-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="11" height="11" focusable="false">
          <path
            d="M14.5 5.5 8 12l6.5 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="nexo-atras-label">{label}</span>
    </button>
  );
}
