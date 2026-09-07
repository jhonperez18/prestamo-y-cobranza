"use client";

import { useEffect, useState } from "react";
import { forceReinstallCanonicalPackage } from "@/lib/bootstrap-demo-data";
import { DATA_RETENTION_DAYS } from "@/lib/data-retention";
import { importDemoSnapshot } from "@/lib/demo-persist";

/** Pantalla de respaldo manual; el arranque normal ya restaura solo. */
export default function RecoveryPage() {
  const [status, setStatus] = useState("Reinstalando paquete canónico (Chrome)…");

  useEffect(() => {
    const result = forceReinstallCanonicalPackage();
    setStatus(
      result.restored
        ? `Listo. Paquete Chrome montado (días 3–5 + banco + 10 clientes). Retención: ${DATA_RETENTION_DAYS} días (corte ${result.retention?.cutoff ?? "—"}). Redirigiendo…`
        : `Paquete ya aplicado o sin cambios. Retención: ${DATA_RETENTION_DAYS} días. Redirigiendo…`,
    );
    const t = window.setTimeout(() => {
      window.location.href = "/";
    }, 1400);
    return () => window.clearTimeout(t);
  }, []);

  function restoreFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const result = importDemoSnapshot(text);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      forceReinstallCanonicalPackage();
      setStatus("Archivo restaurado. Recargando…");
      window.setTimeout(() => {
        window.location.href = "/";
      }, 700);
    };
    reader.readAsText(file);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(160deg, #e8f2ec, #f7f4ef)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <section
        style={{
          maxWidth: 520,
          width: "100%",
          background: "#fff",
          border: "1px solid #c5d5cb",
          borderRadius: 12,
          padding: "28px 24px",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 26, color: "#1f3d32" }}>Datos protegidos</h1>
        <p style={{ margin: "0 0 14px", color: "#4a6358", lineHeight: 1.45 }}>
          Reinstala el paquete canónico (igual Chrome) y retención de {DATA_RETENTION_DAYS} días.
        </p>
        <p style={{ margin: "0 0 14px", color: "#2f5344", lineHeight: 1.45 }}>{status}</p>
        <label
          style={{
            display: "block",
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px dashed #8aa696",
            textAlign: "center",
            color: "#2f5344",
            cursor: "pointer",
          }}
        >
          Cargar otro JSON de respaldo…
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => restoreFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <p style={{ marginTop: 14, textAlign: "center" }}>
          <a href="/" style={{ color: "#2f5344" }}>
            Ir al login
          </a>
        </p>
      </section>
    </main>
  );
}
