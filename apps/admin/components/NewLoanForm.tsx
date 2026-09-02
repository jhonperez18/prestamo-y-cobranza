"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CloseIcon, SearchIcon } from "@/components/icons";
import { money, nextLoanCode, type ClientRow, type LoanRow } from "@/lib/mock-data";
import {
  buildLoanPreviewCards,
  displayToIso,
  isoToDisplay,
  LOAN_FORM_MODES,
  PACT_KINDS,
  PAY_FREQUENCIES,
  previewLoan,
  rateFieldLabel,
  syncLoan,
  type ChargeMode,
  type PactKind,
  type PayFrequency,
  type ScheduleLine,
} from "@/lib/loan-preview";
import { LoanScheduleTable } from "@/components/LoanScheduleTable";
import { todayIso } from "@/lib/daily-dispatch";

export type LoanDraft = {
  clientRef: string;
  capital: number;
  date: string;
  due: string;
  notes: string;
  rate: number;
  frequency: PayFrequency;
  mode: ChargeMode;
  pact: PactKind;
  days: number;
  interest: number;
  total: number;
  installment: number;
  schedule: ScheduleLine[];
};

type Props = {
  clients: ClientRow[];
  loan?: LoanRow;
  loanCode?: string;
  onCancel: () => void;
  onSave: (draft: LoanDraft) => void;
  onDelete?: () => void;
};

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function matchesClient(client: ClientRow, query: string) {
  const q = fold(query);
  if (!q) return true;
  const hay = fold(
    [client.ref, client.name, client.lastName, `${client.name} ${client.lastName}`, client.document, client.phone, client.city, client.route].join(
      " ",
    ),
  );
  return q.split(" ").every((part) => hay.includes(part));
}

function parseCapital(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function parseRate(raw: string) {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function NewLoanForm({ clients, loan, loanCode, onCancel, onSave, onDelete }: Props) {
  const editing = Boolean(loan);
  const syncedLoan = useMemo(() => (loan ? syncLoan(loan, undefined) : null), [loan]);
  const code = loan?.ref ?? loanCode ?? nextLoanCode();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [client, setClient] = useState<ClientRow | null>(
    () => (loan ? (clients.find((row) => row.ref === loan.clientRef) ?? null) : null),
  );
  const [capitalRaw, setCapitalRaw] = useState(syncedLoan ? String(syncedLoan.capital) : loan ? String(loan.capital) : "");
  const [rateRaw, setRateRaw] = useState(syncedLoan?.rate != null ? String(syncedLoan.rate) : loan?.rate != null ? String(loan.rate) : "");
  const [cuotaRaw, setCuotaRaw] = useState(
    syncedLoan?.installment != null ? String(syncedLoan.installment) : loan?.installment != null ? String(loan.installment) : "",
  );
  const [startIso, setStartIso] = useState(
    syncedLoan ? displayToIso(syncedLoan.date) || todayIso() : loan ? displayToIso(loan.date) || todayIso() : todayIso(),
  );
  const [dueIso, setDueIso] = useState(syncedLoan ? displayToIso(syncedLoan.due) : loan ? displayToIso(loan.due) : "");
  const [frequency, setFrequency] = useState<PayFrequency>(syncedLoan?.frequency ?? loan?.frequency ?? "diario");
  const [pact, setPact] = useState<PactKind>(syncedLoan?.pact ?? loan?.pact ?? "tasa");
  const [notes, setNotes] = useState(syncedLoan?.notes ?? loan?.notes ?? "");
  const [askingDelete, setAskingDelete] = useState(false);

  const suggestions = useMemo(() => clients.filter((row) => matchesClient(row, query)), [clients, query]);
  const showList = !client && (focused || query.trim().length > 0);
  const capital = parseCapital(capitalRaw);
  const rate = parseRate(rateRaw);
  const cuota = parseCapital(cuotaRaw);
  const resolvedPact: PactKind = pact;
  const usesValor = resolvedPact === "valor";
  const preview = previewLoan({
    capital,
    startIso,
    dueIso,
    frequency,
    mode: "interes",
    pact: resolvedPact,
    rate,
    cuota,
  });

  function pick(row: ClientRow) {
    setClient(row);
    setQuery("");
    setFocused(false);
  }

  function clearClient() {
    setClient(null);
    setQuery("");
    setFocused(true);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !preview) return;
    onSave({
      clientRef: client.ref,
      capital,
      date: isoToDisplay(startIso),
      due: isoToDisplay(dueIso),
      notes: notes.trim(),
      rate: usesValor ? 0 : rate,
      frequency,
      mode: "interes",
      pact: resolvedPact,
      days: preview.days,
      interest: preview.interest,
      total: preview.total,
      installment: preview.installment,
      schedule: preview.schedule,
    });
  }

  const initials = client
    ? `${client.name.charAt(0)}${client.lastName.charAt(0)}`.toUpperCase()
    : "";
  const address = client ? [client.address, client.barrio, client.city].filter(Boolean).join(", ") : "";

  return (
    <form className="loan-create" onSubmit={onSubmit}>
      {!client ? (
        <div className="client-pick">
          <label className="sheet-label" htmlFor="loan-client-search">
            Cliente
          </label>
          <div className="client-search">
            <SearchIcon size={16} />
            <input
              id="loan-client-search"
              value={query}
              placeholder="Buscar cliente creado: nombre, documento o código"
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => window.setTimeout(() => setFocused(false), 180)}
            />
          </div>
          {showList ? (
            <div className="client-suggest" role="listbox">
              {suggestions.length === 0 ? (
                <p>No hay clientes con ese dato. Créelo primero en Clientes.</p>
              ) : (
                suggestions.map((row) => (
                  <button key={row.ref} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(row)}>
                    <span className="suggest-photo">
                      {row.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.photo} alt="" />
                      ) : (
                        `${row.name.charAt(0)}${row.lastName.charAt(0)}`.toUpperCase()
                      )}
                    </span>
                    <span className="suggest-meta">
                      <b>
                        {row.name} {row.lastName}
                      </b>
                      <span>
                        {row.ref} · {row.document || "Sin documento"} · {row.route || "Sin ruta"}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {client ? (
        <div className="ficha">
          <aside className="ficha-side">
            <div className="photo">
              {client.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={client.photo} alt={`${client.name} ${client.lastName}`} />
              ) : (
                initials
              )}
            </div>
            <h2>
              {client.name} {client.lastName}
            </h2>
            <p>Cliente activo · {client.ref}</p>
            <div className="meta">
              <div>
                <span>Documento</span>
                {client.document || "—"}
              </div>
              <div>
                <span>Teléfono</span>
                {client.phone || "—"}
              </div>
              <div>
                <span>Dirección</span>
                {address || "—"}
              </div>
              <div>
                <span>Ruta</span>
                {client.route || "—"}
              </div>
            </div>
            {editing ? null : (
              <div className="ficha-actions">
                <button type="button" className="btn ghost" onClick={clearClient}>
                  <CloseIcon size={14} /> Cambiar cliente
                </button>
              </div>
            )}
          </aside>

          <div className="ficha-main">
            <div className="loan-file-title">
              <h1>Ficha del préstamo</h1>
              <b className="sheet-code">{code}</b>
            </div>

            <div className="sheet loan-sheet">
            <div className="sheet-fields">
              <div className="sheet-row split">
                <label className="sheet-label" htmlFor="loan-capital">
                  Capital
                </label>
                <input
                  id="loan-capital"
                  value={capitalRaw}
                  onChange={(event) => setCapitalRaw(event.target.value)}
                  required
                  inputMode="numeric"
                  placeholder="Monto a prestar"
                />
                <label className="sheet-label" htmlFor="loan-mode">
                  Modalidad
                </label>
                <select id="loan-mode" value="interes" disabled aria-disabled>
                  {LOAN_FORM_MODES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sheet-row split">
                <label className="sheet-label" htmlFor="loan-date">
                  Desembolso
                </label>
                <input id="loan-date" type="date" required value={startIso} onChange={(event) => setStartIso(event.target.value)} />
                <label className="sheet-label" htmlFor="loan-due">
                  Vencimiento
                </label>
                <input
                  id="loan-due"
                  type="date"
                  required
                  min={startIso}
                  value={dueIso}
                  onChange={(event) => setDueIso(event.target.value)}
                />
              </div>
              <div className="sheet-row split">
                <label className="sheet-label" htmlFor="loan-freq">
                  Frecuencia de cobro
                </label>
                <select id="loan-freq" value={frequency} onChange={(event) => setFrequency(event.target.value as PayFrequency)}>
                  {PAY_FREQUENCIES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <label className="sheet-label" htmlFor="loan-pact">
                  Cómo se pacta
                </label>
                <select id="loan-pact" value={pact} onChange={(event) => setPact(event.target.value as PactKind)}>
                  {PACT_KINDS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              {usesValor ? (
                <div className="sheet-row">
                  <label className="sheet-label" htmlFor="loan-cuota">
                    Valor de cada cobro
                  </label>
                  <input
                    id="loan-cuota"
                    value={cuotaRaw}
                    onChange={(event) => setCuotaRaw(event.target.value)}
                    required
                    inputMode="numeric"
                    placeholder="Ej. 20000"
                  />
                </div>
              ) : (
                <div className="sheet-row">
                  <label className="sheet-label" htmlFor="loan-rate">
                    {rateFieldLabel(frequency)}
                  </label>
                  <input
                    id="loan-rate"
                    value={rateRaw}
                    onChange={(event) => setRateRaw(event.target.value)}
                    required
                    inputMode="decimal"
                    placeholder="Ej. 20"
                  />
                </div>
              )}
              <div className="sheet-row sheet-row-top">
                <label className="sheet-label" htmlFor="loan-notes">
                  Observaciones
                </label>
                <textarea
                  id="loan-notes"
                  rows={3}
                  placeholder="Nota interna, opcional"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </div>
            </div>

            {preview ? (
              <>
                <div className="loan-preview">
                  {buildLoanPreviewCards({
                    capital,
                    installment: preview.installment,
                    interest: preview.interest,
                    total: preview.total,
                    days: preview.days,
                    interestCount: preview.interestCount,
                    mode: "interes",
                    pact: resolvedPact,
                    formatMoney: money,
                  }).map((fact) => (
                    <div key={fact.label}>
                      <span>{fact.label}</span>
                      <b>{fact.value}</b>
                    </div>
                  ))}
                </div>
                <LoanScheduleTable schedule={preview.schedule} />
              </>
            ) : (
              <p className="pick-hint">
                Indique capital, vencimiento y {usesValor ? "el valor pactado" : "el interés"} para ver fechas y el monto a pagar.
              </p>
            )}

            <div className="form-actions">
              {askingDelete ? (
                <>
                  <p className="ficha-warn">¿Eliminar este préstamo? Saldrá del listado.</p>
                  <button type="button" className="btn ghost" onClick={() => setAskingDelete(false)}>
                    Cancelar
                  </button>
                  <button type="button" className="btn danger" onClick={onDelete}>
                    Sí, eliminar
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn ghost" onClick={onCancel}>
                    Cancelar
                  </button>
                  {editing && onDelete ? (
                    <button type="button" className="btn danger" onClick={() => setAskingDelete(true)}>
                      Borrar
                    </button>
                  ) : null}
                  <button type="submit" className="btn primary" disabled={!preview}>
                    Guardar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
