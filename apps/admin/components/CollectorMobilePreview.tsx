"use client";

import { useMemo } from "react";
import { CollectorMobileApp } from "@/components/CollectorMobileApp";
import { MobilePreviewFrame } from "@/components/MobilePreviewFrame";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { ClientRow, CollectorRow, LoanRow, RouteRow } from "@/lib/mock-data";

type Props = {
  collectors: CollectorRow[];
  selectedRef: string;
  onSelect: (ref: string) => void;
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  loans: LoanRow[];
  clients: ClientRow[];
};

export function CollectorMobilePreview({
  collectors,
  selectedRef,
  onSelect,
  assignments,
  routes,
  loans,
  clients,
}: Props) {
  const mobileCollectors = useMemo(
    () => collectors.filter((row) => row.mobileAccess && row.active),
    [collectors],
  );
  const collector =
    mobileCollectors.find((row) => row.ref === selectedRef) ?? mobileCollectors[0] ?? null;

  return (
    <section className="panel collector-mobile-preview-panel">
      <div className="head">
        <h1>Vista móvil</h1>
      </div>

      <div className="collector-preview-controls">
        <label className="collector-preview-picker">
          <select
            value={collector?.ref ?? ""}
            onChange={(event) => onSelect(event.target.value)}
          >
            {mobileCollectors.length === 0 ? (
              <option value="">Sin cobradores móviles</option>
            ) : (
              mobileCollectors.map((row) => (
                <option key={row.ref} value={row.ref}>
                  {row.name} · {row.login ?? row.ref}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      {!collector ? (
        <p className="ficha-empty">Crea un usuario cobrador con acceso móvil para previsualizar.</p>
      ) : (
        <MobilePreviewFrame title={`${collector.name} · app`}>
          <CollectorMobileApp
            collector={collector}
            assignments={assignments}
            routes={routes}
            loans={loans}
            clients={clients}
            preview
            canRegister={false}
          />
        </MobilePreviewFrame>
      )}
    </section>
  );
}
