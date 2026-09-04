"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CloseIcon, SearchIcon } from "@/components/icons";
import { money, nextLoanCode, type ClientRow, type LoanRow } from "@/lib/mock-data";
import { isOperationalClient } from "@/lib/client-review";
import {
  buildFlatLoanPreviewCards,
  displayToIso,
  firstCollectionLabel,
  inferTermMonths,
  isoToDisplay,
  LOAN_TERM_OPTIONS,
  PAY_FREQUENCIES,
  previewLoanFlat,
  syncLoan,
  type LoanTermMonths,
  type PayFrequency,
  type ScheduleLine,
} from "@/lib/loan-preview";
import { todayIso } from "@/lib/daily-dispatch";

export type LoanDraft = {
  clientRef: string;
  capital: number;
  date: string;
  due: string;
  notes: string;
  rate: number;
  frequency: PayFrequency;
  mode: "cuota_fija";
  pact: "valor";
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
    [
      client.ref,
      client.name,
      client.lastName,
      `${client.name} ${client.lastName}`,
      client.document,
      client.phone,
      client.city,
      client.route,
    ].join(" "),
  );
  return q.split(" ").every((part) => hay.includes(part));
}

function parseMoney(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

const INTEREST_PCT_OPTIONS = [5, 10, 15, 20] as const;
type InterestPct = (typeof INTEREST_PCT_OPTIONS)[number];
type InterestInputMode = "pct" | "amount" | null;

function matchInterestPct(capital: number, interest: number): InterestPct | null {
  if (capital <= 0 || interest <= 0) return null;
  for (const pct of INTEREST_PCT_OPTIONS) {
    const expected = Math.trunc((capital * pct) / 100);
    if (expected === interest) return pct;
  }
  return null;
}

function initialTermMonths(loan?: LoanRow | null): LoanTermMonths {
  if (!loan) return 1;
  const start = displayToIso(loan.date);
  const due = displayToIso(loan.due);
  if (start && due) return inferTermMonths(start, due);
  return 1;
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
  const [capitalRaw, setCapitalRaw] = useState(
    syncedLoan ? String(syncedLoan.capital) : loan ? String(loan.capital) : "",
  );
  const seedInterest =
    syncedLoan?.interest != null
      ? syncedLoan.interest
      : loan?.interest != null
        ? loan.interest
        : 0;
  const seedCapital = syncedLoan?.capital ?? loan?.capital ?? 0;
  const seedPct = matchInterestPct(seedCapital, seedInterest);
  const [interestMode, setInterestMode] = useState<InterestInputMode>(() => {
    if (seedInterest <= 0) return null;
    return seedPct != null ? "pct" : "amount";
  });
  const [ratePct, setRatePct] = useState<InterestPct | null>(() => seedPct);
  const [interestRaw, setInterestRaw] = useState(
    seedInterest > 0 && seedPct == null ? String(seedInterest) : "",
  );
  const [termMonths, setTermMonths] = useState<LoanTermMonths>(() => initialTermMonths(loan ?? null));
  const [startIso, setStartIso] = useState(
    syncedLoan
      ? displayToIso(syncedLoan.date) || todayIso()
      : loan
        ? displayToIso(loan.date) || todayIso()
        : todayIso(),
  );
  const [frequency, setFrequency] = useState<PayFrequency>(
    syncedLoan?.frequency ?? loan?.frequency ?? "diario",
  );
  const [notes, setNotes] = useState(syncedLoan?.notes ?? loan?.notes ?? "");
  const [askingDelete, setAskingDelete] = useState(false);

  const suggestions = useMemo(
    () => clients.filter((row) => isOperationalClient(row) && matchesClient(row, query)),
    [clients, query],
  );
  const showList = !client && (focused || query.trim().length > 0);
  const capital = parseMoney(capitalRaw);
  const interestFromPct =
    interestMode === "pct" && ratePct != null && capital > 0
      ? Math.trunc((capital * ratePct) / 100)
      : 0;
  const interestFromAmount = interestMode === "amount" ? parseMoney(interestRaw) : 0;
  const interest = interestMode === "pct" ? interestFromPct : interestFromAmount;
  const totalDue = capital + interest;
  const preview = previewLoanFlat({
    capital,
    interest,
    startIso,
    frequency,
    termMonths,
  });
  const frequencyLabel =
    PAY_FREQUENCIES.find((item) => item.id === frequency)?.label ?? "Diario";
  const termLabel = LOAN_TERM_OPTIONS.find((item) => item.id === termMonths)?.label ?? "1 mes";
  const dueLabel = preview?.dates.length
    ? isoToDisplay(preview.dates[preview.dates.length - 1])
    : "—";
  const cobroDayLabel = firstCollectionLabel(startIso, frequency);
  const interestSelectValue =
    interestMode === "amount" ? "amount" : ratePct != null ? String(ratePct) : "";

  function onInterestSelect(value: string) {
    if (!value) {
      setInterestMode(null);
      setRatePct(null);
      setInterestRaw("");
      return;
    }
    if (value === "amount") {
      setInterestMode("amount");
      setRatePct(null);
      return;
    }
    const pct = Number(value) as InterestPct;
    setInterestMode("pct");
    setRatePct(pct);
    setInterestRaw("");
  }

  function onAmountChange(raw: string) {
    setInterestMode("amount");
    setRatePct(null);
    setInterestRaw(raw);
  }

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
      due: dueLabel,
      notes: notes.trim(),
      rate: interestMode === "pct" ? ratePct ?? 0 : 0,
      frequency,
      mode: "cuota_fija",
      pact: "valor",
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
  const address = client
    ? [client.address, client.barrio, client.city].filter(Boolean).join(", ")
    : "";

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
                  <button
                    key={row.ref}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(row)}
                  >
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
                <div className="sheet-row loan-capital-interest-row">
                  <label className="sheet-label" htmlFor="loan-capital">
                    Capital
                  </label>
                  <input
                    id="loan-capital"
                    className="loan-capital-input"
                    value={capitalRaw}
                    onChange={(event) => setCapitalRaw(event.target.value)}
                    required
                    inputMode="numeric"
                    placeholder="Monto"
                  />
                  <label className="sheet-label" htmlFor="loan-interest-kind">
                    Interés
                  </label>
                  <select
                    id="loan-interest-kind"
                    className="loan-interest-select"
                    value={interestSelectValue}
                    onChange={(event) => onInterestSelect(event.target.value)}
                    required
                  >
                    <option value="">Elegir…</option>
                    {INTEREST_PCT_OPTIONS.map((pct) => (
                      <option key={pct} value={pct}>
                        {pct}%
                      </option>
                    ))}
                    <option value="amount">Monto fijo…</option>
                  </select>
                  {interestMode === "pct" ? (
                    <input
                      className="loan-interest-result"
                      value={capital > 0 && interestFromPct > 0 ? money(interestFromPct) : ""}
                      readOnly
                      tabIndex={-1}
                      aria-label="Valor del interés calculado"
                      placeholder="$ interés"
                    />
                  ) : interestMode === "amount" ? (
                    <input
                      id="loan-interest"
                      className="loan-interest-amount-input"
                      value={interestRaw}
                      onChange={(event) => onAmountChange(event.target.value)}
                      required
                      inputMode="numeric"
                      placeholder="Valor fijo"
                    />
                  ) : (
                    <input
                      className="loan-interest-result"
                      value=""
                      readOnly
                      tabIndex={-1}
                      placeholder="—"
                      aria-hidden
                    />
                  )}
                  <label className="sheet-label" htmlFor="loan-total">
                    Total
                  </label>
                  <input
                    id="loan-total"
                    className="loan-total-input"
                    value={totalDue > 0 ? money(totalDue) : ""}
                    readOnly
                    tabIndex={-1}
                    title="Monto a pagar (capital + interés)"
                    placeholder="Capital + interés"
                  />
                </div>

                <div className="sheet-row loan-term-row">
                  <label className="sheet-label" htmlFor="loan-date">
                    Desembolso
                  </label>
                  <input
                    id="loan-date"
                    type="date"
                    required
                    value={startIso}
                    onChange={(event) => setStartIso(event.target.value)}
                  />
                  <label className="sheet-label" htmlFor="loan-term">
                    Tiempo
                  </label>
                  <select
                    id="loan-term"
                    value={termMonths}
                    onChange={(event) => setTermMonths(Number(event.target.value) as LoanTermMonths)}
                  >
                    {LOAN_TERM_OPTIONS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <label className="sheet-label" htmlFor="loan-freq">
                    Frecuencia
                  </label>
                  <select
                    id="loan-freq"
                    value={frequency}
                    onChange={(event) => setFrequency(event.target.value as PayFrequency)}
                  >
                    {PAY_FREQUENCIES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sheet-row loan-cuotas-row">
                  <label className="sheet-label" htmlFor="loan-cuotas">
                    # de cuotas
                  </label>
                  <input
                    id="loan-cuotas"
                    value={preview ? String(preview.count) : ""}
                    readOnly
                    tabIndex={-1}
                    placeholder="Según tiempo y frecuencia"
                  />
                  <label className="sheet-label" htmlFor="loan-cobro-dia">
                    Día de cobro
                  </label>
                  <input
                    id="loan-cobro-dia"
                    value={cobroDayLabel}
                    readOnly
                    tabIndex={-1}
                    title={
                      frequency === "diario"
                        ? "Lunes a sábado"
                        : frequency === "semanal"
                          ? "Cada 8 días desde el desembolso"
                          : frequency === "quincenal"
                            ? "Cada 15 días calendario desde el desembolso"
                            : "Cada mes desde el desembolso"
                    }
                    placeholder="Según frecuencia"
                  />
                  <label className="sheet-label" htmlFor="loan-cuota-valor">
                    Valor cuota
                  </label>
                  <input
                    id="loan-cuota-valor"
                    value={preview ? money(preview.installment) : ""}
                    readOnly
                    tabIndex={-1}
                    placeholder="Monto ÷ cuotas"
                  />
                </div>

                <div className="sheet-row">
                  <label className="sheet-label" htmlFor="loan-due">
                    Vencimiento (última cuota)
                  </label>
                  <input id="loan-due" value={dueLabel === "—" ? "" : dueLabel} readOnly tabIndex={-1} />
                </div>

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
              <div className="loan-preview">
                {buildFlatLoanPreviewCards({
                  capital,
                  interest: preview.interest,
                  total: preview.total,
                  installment: preview.installment,
                  installments: preview.count,
                  days: preview.days,
                  dueLabel,
                  frequencyLabel: `${frequencyLabel} · ${termLabel}`,
                  formatMoney: money,
                }).map((fact) => (
                  <div key={fact.label}>
                    <span>{fact.label}</span>
                    <b>{fact.value}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="loan-sim-hint">
                Complete capital, interés, tiempo y frecuencia para ver el resumen.
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
