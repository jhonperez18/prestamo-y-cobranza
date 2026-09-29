"use client";

import { useState, type FormEvent } from "react";
import { money, type LoanRow } from "@/lib/mock-data";
import { cuotaTarget, payHint, targetLabel, validatePay, type PayKind } from "@/lib/loan-pay";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  normalizePaymentMethod,
} from "@/lib/payment-method";
import type { RouteCollectorCashTarget } from "@/lib/route-collector-cash";

/** oficina = solo carga al sistema; cobrador = además entra a la caja / Nequi del cobrador de la ruta. */
export type PanelPayDestination = "oficina" | "cobrador";

type Props = {
  loan: LoanRow;
  mode: PayKind;
  routeCollector: RouteCollectorCashTarget;
  onCancel: () => void;
  onRegister: (amount: number, method: PaymentMethod, destination: PanelPayDestination) => void;
};

type PayChoice = "cuota" | "otro" | "todo";

function parseAmount(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function LoanPayForm({ loan, mode, routeCollector, onCancel, onRegister }: Props) {
  const [destination, setDestination] = useState<PanelPayDestination>("oficina");
  const target = cuotaTarget(loan);
  const cuotaValue = target?.remaining ?? 0;
  const totalHoy = loan.balance;
  const [choice, setChoice] = useState<PayChoice>(mode === "cuota" ? "cuota" : "otro");
  const [raw, setRaw] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const amount =
    choice === "cuota" ? cuotaValue : choice === "todo" ? totalHoy : parseAmount(raw);
  const title = mode === "cuota" ? "Pagar cuota" : "Abono";
  const error = amount > 0 ? validatePay(loan, mode, amount) : null;
  const hint = payHint(loan, mode, amount);
  const destinationError =
    destination === "cobrador" && !routeCollector.ok ? routeCollector.error : null;
  const canRegister = amount > 0 && !error && !destinationError;
  const collectorName = routeCollector.collector?.name ?? "";
  const payMethod = normalizePaymentMethod(method);
  const collectorDestinationHint =
    payMethod === "efectivo"
      ? "Entra a la caja de hoy del cobrador"
      : payMethod === "nequi"
        ? "Queda en el Nequi de la ruta (lo ve el supervisor)"
        : "Queda a nombre de la ruta · no entra a la caja";
  const canTodo = mode === "cuota" && totalHoy > 0;
  const facts = [
    ["Capital inicial", money(loan.capital)],
    ["Valor cuota", cuotaValue > 0 ? money(cuotaValue) : "—"],
    ["Cuota en cobro", targetLabel(target)],
    ["Total del préstamo a la fecha", money(totalHoy)],
  ] as const;

  function pick(next: PayChoice) {
    setChoice(next);
    if (next !== "otro") setRaw("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRegister) return;
    onRegister(amount, normalizePaymentMethod(method), destination);
  }

  return (
    <form className="pay-box is-compact" onSubmit={onSubmit}>
      <h2>{title}</h2>
      <div className="pay-grid">
        <div className="table-wrap">
          <table className="data mini-grid">
            <thead>
              <tr className="col-titles">
                <th className="is-concepto">Concepto</th>
                <th className="is-valor">Valor</th>
              </tr>
            </thead>
            <tbody>
              {facts.map(([label, value]) => (
                <tr key={label}>
                  <td className="is-concepto">{label}</td>
                  <td className="money is-valor">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pay-line">
          <p className="pay-choice-label">Monto a registrar</p>
          <div className="pay-choice" role="radiogroup" aria-label="Monto a registrar">
            <label className={choice === "cuota" ? "on" : undefined}>
              <input
                type="radio"
                name="pay-choice"
                checked={choice === "cuota"}
                disabled={cuotaValue <= 0}
                onChange={() => pick("cuota")}
              />
              <span>Valor cuota</span>
              <b>{cuotaValue > 0 ? money(cuotaValue) : "—"}</b>
            </label>
            <label className={choice === "otro" ? "on" : undefined}>
              <input type="radio" name="pay-choice" checked={choice === "otro"} onChange={() => pick("otro")} />
              <span>Otro monto</span>
              {choice === "otro" ? (
                <input
                  id="pay-amount"
                  className="pay-other"
                  value={raw}
                  onChange={(event) => setRaw(event.target.value)}
                  inputMode="numeric"
                  placeholder="Escriba el valor"
                  autoFocus
                />
              ) : (
                <b>—</b>
              )}
            </label>
            {canTodo ? (
              <label className={choice === "todo" ? "on" : undefined}>
                <input type="radio" name="pay-choice" checked={choice === "todo"} onChange={() => pick("todo")} />
                <span>Pagar todo</span>
                <b>{money(totalHoy)}</b>
              </label>
            ) : null}
          </div>
        </div>

        <div className="pay-line">
          <p className="pay-choice-label">Forma de pago</p>
          <div className="pay-choice pay-method" role="radiogroup" aria-label="Forma de pago">
            {PAYMENT_METHODS.map((entry) => (
              <label key={entry.id} className={method === entry.id ? "on" : undefined}>
                <input
                  type="radio"
                  name="pay-method"
                  checked={method === entry.id}
                  onChange={() => setMethod(entry.id)}
                />
                <span>{entry.label}</span>
                <b>{entry.id === "efectivo" ? "Requiere firma" : "Requiere comprobante"}</b>
              </label>
            ))}
          </div>
        </div>

        <div className="pay-line">
          <p className="pay-choice-label">Destino de la plata</p>
          <div className="pay-choice pay-destination" role="radiogroup" aria-label="Destino de la plata">
            <label className={destination === "oficina" ? "on" : undefined}>
              <input
                type="radio"
                name="pay-destination"
                checked={destination === "oficina"}
                onChange={() => setDestination("oficina")}
              />
              <span>Solo sistema</span>
              <b>Oficina · no toca al cobrador</b>
            </label>
            <label className={destination === "cobrador" ? "on" : undefined}>
              <input
                type="radio"
                name="pay-destination"
                checked={destination === "cobrador"}
                disabled={!routeCollector.collector}
                onChange={() => setDestination("cobrador")}
              />
              <span>{collectorName ? `Cobrador · ${collectorName}` : "Cobrador de la ruta"}</span>
              <b>{routeCollector.collector ? collectorDestinationHint : "Sin cobrador en la ruta"}</b>
            </label>
          </div>
        </div>
      </div>

      <p className="pick-hint">{destinationError ?? hint}</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={!canRegister}>
          Registrar
        </button>
      </div>
    </form>
  );
}
