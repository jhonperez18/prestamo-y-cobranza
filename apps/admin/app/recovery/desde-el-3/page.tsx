"use client";

import { useEffect, useState } from "react";
import { importDemoSnapshot } from "@/lib/demo-persist";

/**
 * Restaura el paquete real de cobros (días 3–5 Sep 2026) desde el respaldo
 * de Chrome. No inventa fechas: vuelve al historial original.
 */
export default function RestoreFromDay3Page() {
  const [status, setStatus] = useState("Restaurando historial desde el día 3…");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch("/recovery/nexo-respaldo-sabado-recovery.json", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`No se pudo leer el respaldo (${res.status})`);
        const raw = await res.text();
        const result = importDemoSnapshot(raw);
        if (!result.ok) throw new Error(result.error);

        try {
          window.localStorage.setItem("nexo-demo-bootstrap-package-v11", "1");
          window.localStorage.setItem("nexo-demo-bootstrap-package-v10", "1");
          window.localStorage.setItem("nexo-demo-bootstrap-package-v9", "1");
          window.localStorage.setItem("nexo-demo-bootstrap-package-v8", "1");
          window.localStorage.setItem("nexo-demo-bootstrap-package-v7", "1");
          window.localStorage.setItem("nexo-demo-bootstrap-package-v6", "1");
          window.localStorage.setItem("nexo-demo-bootstrap-package-v5", "1");
          window.localStorage.setItem("nexo-demo-bootstrap-package-v4", "1");
          window.localStorage.setItem("nexo-demo-bootstrap-package-v3", "1");
          window.localStorage.setItem("nexo-demo-bootstrap-package-v2", "1");
        } catch {
          /* ignore */
        }

        if (cancelled) return;
        setStatus(
          "Listo. Historial restaurado: días 3, 4 y 5 (pagos, cierres, banco). Redirigiendo…",
        );
        window.setTimeout(() => {
          window.location.href = "/";
        }, 1200);
      } catch (err) {
        if (cancelled) return;
        setStatus(err instanceof Error ? err.message : "Error al restaurar");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f3f6f4",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <section
        style={{
          maxWidth: 480,
          width: "100%",
          background: "#fff",
          border: "1px solid #c5d5cb",
          borderRadius: 12,
          padding: "28px 24px",
        }}
      >
        <h1 style={{ margin: "0 0 10px", fontSize: 22, color: "#1f3d32" }}>
          Restaurar desde el día 3
        </h1>
        <p style={{ margin: 0, color: "#2f5344", lineHeight: 1.5 }}>{status}</p>
      </section>
    </main>
  );
}
