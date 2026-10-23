"use client";

import { useState } from "react";
import { PlusIcon } from "@/components/icons";
import { clientsOnRouteSorted, compareRouteNames, sameRoute } from "@/lib/client-route-order";
import { loanIsClosedHistory, loanRenewalOf } from "@/lib/loan-renewal-marks";
import { isLoanActive, money, type ClientRow, type LoanRow } from "@/lib/mock-data";

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

/** El de ahora: sigue debiendo. El viejo (finalizado, renovado o en cero) no entra. */
function owesNow(loan: LoanRow) {
  return isLoanActive(loan) && Number(loan.balance) > 0 && !loanIsClosedHistory(loan);
}

/** Si un cliente trae dos vigentes, se queda el de ahora. */
function pickCurrent(rows: LoanRow[]) {
  return rows.reduce((best, row) => {
    if (loanRenewalOf(row) === best.ref) return row;
    if (loanRenewalOf(best) === row.ref) return best;
    const left = row.createdAt || row.updatedAt || "";
    const right = best.createdAt || best.updatedAt || "";
    if (left !== right) return left > right ? row : best;
    return row.ref.localeCompare(best.ref, "es", { numeric: true }) > 0 ? row : best;
  });
}

function vigenteLoans(loans: LoanRow[]) {
  const groups = new Map<string, LoanRow[]>();
  for (const loan of loans) {
    if (!owesNow(loan)) continue;
    const key = loan.clientRef.trim() || loan.ref;
    const list = groups.get(key) ?? [];
    list.push(loan);
    groups.set(key, list);
  }
  return [...groups.values()].map((rows) => (rows.length === 1 ? rows[0]! : pickCurrent(rows)));
}

function matchesQuery(loan: LoanRow, clients: ClientRow[], query: string) {
  const client = clients.find((row) => row.ref === loan.clientRef);
  const hay = [loan.ref, loan.client, client?.name, client?.lastName, client?.document]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(query);
}

/**
 * Listado de préstamos en las cuatro rutas.
 * Solo pinta. El clic y el alta son los de siempre.
 */
export function LoanRouteBoard({
  title,
  loans,
  clients,
  routeNames,
  onOpen,
  onOpenClient,
  onCreate,
}: {
  title: string;
  loans: LoanRow[];
  clients: ClientRow[];
  routeNames: string[];
  onOpen: (ref: string) => void;
  onOpenClient?: (ref: string) => void;
  onCreate?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [freeQuery, setFreeQuery] = useState("");
  const q = query.trim().toLowerCase();
  const freeQ = freeQuery.trim().toLowerCase();
  const current = vigenteLoans(loans);
  const withLoan = new Set(current.map((loan) => loan.clientRef.trim()).filter(Boolean));
  const freeRoutes = [...new Set(routeNames.map((name) => name.trim()).filter(Boolean))]
    .sort(compareRouteNames)
    .map((name) => ({
      name,
      rows: clientsOnRouteSorted(clients, name).filter((client) => !withLoan.has(client.ref)),
    }));
  const freeTotal = freeRoutes.reduce((sum, route) => sum + route.rows.length, 0);
  const names = [...new Set([...routeNames, ...current.map((loan) => routeOf(loan, clients))])]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort(compareRouteNames);
  const loose = current.filter(
    (loan) => !names.some((name) => sameRoute(routeOf(loan, clients), name)),
  );

  return (
    <>
    <section className="panel loan-route-board">
      <div className="head is-client-board">
        <div className="client-board-title">
          <h1>{title}</h1>
          <span className="count">{current.length}</span>
        </div>
        <input
          className="client-board-search"
          value={query}
          placeholder="Buscar"
          aria-label="Buscar en las cuatro rutas"
          onChange={(event) => setQuery(event.target.value)}
        />
        {onCreate ? (
          <button className="plus" title="Crear" onClick={onCreate}>
            <PlusIcon />
          </button>
        ) : null}
      </div>
      <div className="client-route-board">
        {[...names, ...(loose.length ? ["Sin ruta"] : [])].map((name) => {
          const onRoute =
            name === "Sin ruta"
              ? loose
              : current.filter((loan) => sameRoute(routeOf(loan, clients), name));
          const list = (q ? onRoute.filter((loan) => matchesQuery(loan, clients, q)) : onRoute)
            .slice()
            .sort(
              (a, b) =>
                positionOf(a, clients) - positionOf(b, clients) ||
                a.ref.localeCompare(b.ref, "es", { numeric: true }),
            );
          return (
            <section key={name} className="client-route-col">
              <div className="client-route-col-head">
                <span className="client-route-tab">
                  {name === "Sin ruta" ? "Sin ruta" : `Ruta ${name}`} <strong>{onRoute.length}</strong>
                </span>
              </div>
              <div className="table-wrap">
                <table className="data list-grid">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th className="is-nombre">Nombre</th>
                      <th className="right">Presto</th>
                      <th className="right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.length ? (
                      list.map((row) => (
                        <tr key={row.ref} className="clickable" onClick={() => onOpen(row.ref)}>
                          <td className="ref">{row.ref}</td>
                          <td className="is-nombre">{row.client}</td>
                          <td className="money">{money(Number(row.capital) || 0)}</td>
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
                        <td colSpan={4} className="is-nombre">
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
    <section className="panel loan-route-board is-sin-prestamo">
      <div className="head is-client-board">
        <div className="client-board-title">
          <h1>Sin préstamos</h1>
          <span className="count">{freeTotal}</span>
        </div>
        <input
          className="client-board-search"
          value={freeQuery}
          placeholder="Buscar"
          aria-label="Buscar sin préstamos"
          onChange={(event) => setFreeQuery(event.target.value)}
        />
      </div>
      <div className="client-route-board">
        {freeRoutes.map((route) => {
          const list = freeQ
            ? route.rows.filter((client) => {
                const hay = `${client.name} ${client.lastName} ${client.document ?? ""}`.toLowerCase();
                return hay.includes(freeQ);
              })
            : route.rows;
          return (
            <section key={route.name} className="client-route-col">
              <div className="client-route-col-head">
                <span className="client-route-tab">
                  Ruta {route.name} <strong>{route.rows.length}</strong>
                </span>
              </div>
              <div className="table-wrap">
                <table className="data list-grid">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="is-nombre">Nombre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.length ? (
                      list.map((client) => (
                        <tr
                          key={client.ref}
                          className={onOpenClient ? "clickable" : undefined}
                          onClick={() => onOpenClient?.(client.ref)}
                        >
                          <td className="ref">{client.routeOrder}</td>
                          <td className="is-nombre">{`${client.name} ${client.lastName}`.trim()}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="is-nombre">
                          Todos con préstamo
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
    </>
  );
}
