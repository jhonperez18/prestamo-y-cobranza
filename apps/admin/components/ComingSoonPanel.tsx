"use client";

type Props = {
  title: string;
  purpose: string;
  later?: string;
};

/** Pantalla reservada: el menú se mantiene visible con distintivo «próx.» */
export function ComingSoonPanel({ title, purpose, later }: Props) {
  return (
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
  );
}
