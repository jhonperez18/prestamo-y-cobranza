"use client";

import { PlusIcon, SearchIcon } from "@/components/icons";
import type { DataTableFilterOptions } from "@/components/ui";
import { compareRouteNames, sameRoute } from "@/lib/client-route-order";
import { money, type ClientRow, type LoanRow } from "@/lib/mock-data";

function routeOf(loan: LoanRow, clients: ClientRow[]) {
  return clients.find((row) => row.ref === loan.clientRef)?.route ?? "";
}

function positionOf(loan: LoanRow, clients: ClientRow[]) {
  const client = clients.find((row) => row.ref === loan.clientRef);
  const order = Number(client?.routeOrder);
  return Number.isFinite(order) && order > 0 ? order : 999999;
}

/** Finalizado y sin saldo: la hoja muestra «fin». Un saldo vivo se sigue leyendo. */
function finishedWithoutBalance(loan: LoanRow) {
  const status = String(loan.status ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  return status === "finalizado" && !(Number(loan.balance) > 0);
}

/**
 * Listado de préstamos en las cuatro rutas.
 * Solo pinta. El filtro, el clic y el alta son los de siempre.
 */
export function LoanRouteBoard({
  title,
  loans,
  clients,
  routeNames,
  filters,
  onOpen,
  onCreate,
}: {
  title: string;
  loans: LoanRow[];
  clients: ClientRow[];
  routeNames: string[];
  filters?: DataTableFilterOptions;
  onOpen: (ref: string) => void;
  onCreate?: () => void;
}) {
  const names = [...new Set([...routeNames, ...loans.map((loan) => routeOf(loan, clients))])]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort(compareRouteNames);
  const loose = loans.filter(
    (loan) => !names.some((name) => sameRoute(routeOf(loan, clients), name)),
  );
  const query = filters?.query ?? "";
  const routeName = filters?.routeName ?? "";
  const dateFrom = filters?.dateFrom ?? "";
  const dateTo = filters?.dateTo ?? "";

  return (
    <section className="panel loan-route-board">
      <div className="head">
        <h1>{title}</h1>
        <span className="count">{loans.length}</span>
        <div className="grow" />
        {onCreate ? (
          <button className="plus" title="Crear" onClick={onCreate}>
            <PlusIcon />
          </button>
        ) : null}
      </div>
      <div className="filters">
        <input
          placeholder="Buscar…"
          value={query}
          onChange={(event) => filters?.onQueryChange?.(event.target.value)}
          aria-label="Buscar"
        />
        <button className="go" type="button" aria-label="Buscar">
          <SearchIcon size={15} />
        </button>
        <select
          value={routeName}
          onChange={(event) => filters?.onRouteChange?.(event.target.value)}
          aria-label="Filtrar por ruta"
        >
          <option value="">Todas las rutas</option>
          {(filters?.routes ?? names).map((name) => (
            <option key={name} value={name}>
              Ruta {name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(event) => filters?.onDateFromChange?.(event.target.value)}
          aria-label="Desde"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(event) => filters?.onDateToChange?.(event.target.value)}
          aria-label="Hasta"
        />
      </div>
      <div className="client-route-board">
        {[...names, ...(loose.length ? ["Sin ruta"] : [])].map((name) => {
          const list = (name === "Sin ruta" ? loose : loans.filter((loan) => sameRoute(routeOf(loan, clients), name)))
            .sort(
              (a, b) =>
                positionOf(a, clients) - positionOf(b, clients) ||
                a.ref.localeCompare(b.ref, "es", { numeric: true }),
            );
          return (
            <section key={name} className="client-route-col">
              <div className="client-route-col-head">
                <span className="client-route-tab">
                  {name === "Sin ruta" ? "Sin ruta" : `Ruta ${name}`} <strong>{list.length}</strong>
                </span>
              </div>
              <div className="table-wrap">
                <table className="data list-grid">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th className="is-nombre">Nombre</th>
                      <th className="right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.length ? (
                      list.map((row) => (
                        <tr key={row.ref} className="clickable" onClick={() => onOpen(row.ref)}>
                          <td className="ref">{row.ref}</td>
                          <td className="is-nombre">{row.client}</td>
                          <td className="money">
                            {finishedWithoutBalance(row) ? (
                              <span className="loan-board-fin">fin</span>
                            ) : (
                              money(Number(row.balance) || 0)
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="is-nombre">
                          Sin préstamos
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
