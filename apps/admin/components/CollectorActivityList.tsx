"use client";

import { Pill } from "@/components/ui";
import { activityWhenSortKey, formatActivityWhen } from "@/lib/collector-daily-log";
import type { StatusKind } from "@/lib/mock-data";

export type ActivityListItem = {
  ref: string;
  when: string;
  title: string;
  detail: string;
  kind: StatusKind;
  gps?: boolean;
  collectorName?: string;
  onCollectorClick?: () => void;
};

type Props = {
  items: ActivityListItem[];
  showCollector?: boolean;
  emptyMessage?: string;
};

export function sortActivityItems<T extends { when: string }>(items: T[]) {
  return [...items].sort((a, b) => activityWhenSortKey(b.when).localeCompare(activityWhenSortKey(a.when)));
}

export function CollectorActivityList({
  items,
  showCollector = false,
  emptyMessage = "Sin actividad registrada.",
}: Props) {
  const rows = sortActivityItems(items);

  if (!rows.length) {
    return <p className="ficha-empty">{emptyMessage}</p>;
  }

  return (
    <div className="table-wrap activity-table-wrap">
      <table className={`data mini-grid activity-table${showCollector ? " with-collector" : ""}`}>
        <thead>
          <tr className="col-titles">
            <th>Hora</th>
            {showCollector ? <th>Cobrador</th> : null}
            <th>Actividad</th>
            <th>Detalle</th>
            <th className="center">Origen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ref}>
              <td className="activity-when">{formatActivityWhen(row.when)}</td>
              {showCollector ? (
                <td>
                  {row.collectorName && row.onCollectorClick ? (
                    <button
                      type="button"
                      className="btn-link activity-collector"
                      onClick={row.onCollectorClick}
                    >
                      {row.collectorName}
                    </button>
                  ) : (
                    row.collectorName ?? "—"
                  )}
                </td>
              ) : null}
              <td className="activity-title">{row.title}</td>
              <td className="activity-detail">{row.detail || "—"}</td>
              <td className="center">
                <Pill label={row.gps ? "GPS" : "Campo"} kind={row.kind} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
