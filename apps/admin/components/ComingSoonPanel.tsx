"use client";

import {
  ListDataTableShell,
  type ListTableColumn,
} from "@/components/ListDataTableShell";

type Props = {
  title: string;
  purpose: string;
  later?: string;
  /** Si se pasa, muestra la plantilla de tabla (formato definitivo) bajo la nota. */
  tableColumns?: ListTableColumn[];
  tableTitle?: string;
};

/** Pantalla reservada: el menú se mantiene visible con distintivo «próx.» */
export function ComingSoonPanel({
  title,
  purpose,
  later,
  tableColumns,
  tableTitle,
}: Props) {
  return (
    <div className="coming-soon-stack">
      <section className="panel coming-soon-panel">
        <div className="head">
          <h1>{title}</h1>
          <span className="badge badge-soon">próx.</span>
        </div>
        <div className="coming-soon-body">
          <p className="coming-soon-purpose">{purpose}</p>
          {later ? <p className="coming-soon-later">{later}</p> : null}
          <p className="coming-soon-note">
            Esta opción está reservada en el menú para no perderla. Se activará cuando haya backend y
            datos oficiales (PostgreSQL).
          </p>
        </div>
      </section>

      {tableColumns?.length ? (
        <ListDataTableShell
          title={tableTitle ?? title}
          columns={tableColumns}
          count={0}
          emptyMessage="El formato de esta tabla ya está listo. Los datos aparecerán al activar el módulo."
          badge={<span className="badge badge-soon">próx.</span>}
        />
      ) : null}
    </div>
  );
}
