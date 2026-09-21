"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CloseIcon, PersonMiniIcon, SearchIcon } from "@/components/icons";
import { money, nextLoanCode, type ClientRow, type LoanRow } from "@/lib/mock-data";
import { isOperationalClient } from "@/lib/client-review";
import {
  buildFlatLoanPreviewCards,
  displayToIso,
  firstCollectionIso,
  isoToDisplay,
  PAY_FREQUENCIES,
  previewLoanFlat,
  suggestedInstallmentsForDays,
  syncLoan,
  type PayFrequency,
  type ScheduleLine,
} from "@/lib/loan-preview";
import { todayIso } from "@/lib/daily-dispatch";
import {
  loanDisbursementSource,
  stripFundedMarkers,
  type LoanDisbursementSource,
} from "@/lib/nequi-pool";

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
  /** Origen del desembolso: Nequi/Banco (dueño) o Efectivo (caja del cobrador de la ruta). */
  fundedBy?: LoanDisbursementSource;
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

function clientPickDisplayName(client: ClientRow) {
  return `${client.name} ${client.lastName}`.trim();
}

function matchesClient(client: ClientRow, query: string) {
  const q = fold(query);
  if (!q) return true;
  const hay = fold(
    [
      client.ref,
      client.name,
      client.lastName,
      clientPickDisplayName(client),
      String(client.routeOrder || ""),
      client.document,
      client.phone,
      client.city,
      client.route,
    ].join(" "),
  );
  return q.split(" ").every((part) => hay.includes(part));
}

function sortClientsLikeListado(a: ClientRow, b: ClientRow) {
  const routeCmp = a.route.localeCompare(b.route, undefined, { numeric: true });
  if (routeCmp !== 0) return routeCmp;
  return (a.routeOrder || 0) - (b.routeOrder || 0);
}

function parseMoney(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function parsePositiveInt(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return 0;
  return Math.trunc(Number(digits));
}

const INTEREST_PCT_OPTIONS = [5, 10, 15, 20] as const;
type InterestPct = (typeof INTEREST_PCT_OPTIONS)[number];
type InterestInputMode = "pct" | "amount";

function matchInterestPct(capital: number, interest: number): InterestPct | null {
  if (capital <= 0 || interest <= 0) return null;
  for (const pct of INTEREST_PCT_OPTIONS) {
    const expected = Math.trunc((capital * pct) / 100);
    if (expected === interest) return pct;
  }
  return null;
}

function initialTermDays(loan?: LoanRow | null): number {
  if (!loan) return 30;
  if (loan.days != null && loan.days > 0) return Math.trunc(loan.days);
  const start = displayToIso(loan.date);
  const due = displayToIso(loan.due);
  if (start && due) {
    const startMs = Date.parse(`${start}T12:00:00Z`);
    const dueMs = Date.parse(`${due}T12:00:00Z`);
    if (Number.isFinite(startMs) && Number.isFinite(dueMs) && dueMs > startMs) {
      return Math.max(1, Math.round((dueMs - startMs) / 86400000));
    }
  }
  return 30;
}

function initialCuotas(loan?: LoanRow | null, termDays = 30, frequency: PayFrequency = "diario") {
  if (loan?.schedule?.length) {
    const count = loan.schedule.filter((line) => line.kind !== "capital").length;
    if (count > 0) return count;
  }
  return suggestedInstallmentsForDays(frequency, termDays);
}

export function NewLoanForm({ clients, loan, loanCode, onCancel, onSave, onDelete }: Props) {
  const editing = Boolean(loan);
  const syncedLoan = useMemo(() => (loan ? syncLoan(loan, undefined) : null), [loan]);
  const code = loan?.ref ?? loanCode ?? nextLoanCode();
  const [query, setQuery] = useState("");
  const [client, setClient] = useState<ClientRow | null>(
    () => (loan ? (clients.find((row) => row.ref === loan.clientRef) ?? null) : null),
  );

  // Catálogo manda: si renombran el cliente, el picker ya seleccionado se actualiza.
  useEffect(() => {
    if (!client) return;
    const fresh = clients.find((row) => row.ref === client.ref);
    if (!fresh) return;
    if (
      fresh.name !== client.name ||
      fresh.lastName !== client.lastName ||
      fresh.routeOrder !== client.routeOrder
    ) {
      setClient(fresh);
    }
  }, [clients, client]);
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
  // Interés 0 es valor válido y se guarda; nunca “Elegir…” vacío.
  const [interestMode, setInterestMode] = useState<InterestInputMode>(() =>
    seedPct != null ? "pct" : "amount",
  );
  const [ratePct, setRatePct] = useState<InterestPct | null>(() => seedPct);
  const [interestRaw, setInterestRaw] = useState(() => {
    if (seedPct != null) return "";
    return String(Math.max(0, seedInterest));
  });
  const seedDays = initialTermDays(loan ?? null);
  const seedFreq: PayFrequency = syncedLoan?.frequency ?? loan?.frequency ?? "diario";
  const [termDaysRaw, setTermDaysRaw] = useState(String(seedDays));
  const [frequency, setFrequency] = useState<PayFrequency>(seedFreq);
  const seedCuotas = initialCuotas(loan ?? null, seedDays, seedFreq);
  const [cuotasRaw, setCuotasRaw] = useState(String(seedCuotas));
  /** # cuotas del acuerdo: en edición o si ya difiere de la sugerencia, no se recalcula. */
  const cuotasTouchedRef = useRef(
    Boolean(loan) ||
      seedCuotas !== suggestedInstallmentsForDays(seedFreq, seedDays),
  );
  const seedCuota =
    syncedLoan?.installment && syncedLoan.installment > 0
      ? syncedLoan.installment
      : loan?.installment && loan.installment > 0
        ? loan.installment
        : 0;
  const [cuotaRaw, setCuotaRaw] = useState(seedCuota > 0 ? String(seedCuota) : "");
  /** Cuota manual del cliente: se respeta al guardar y al reabrir; no se recalcula sola. */
  const cuotaTouchedRef = useRef(Boolean(loan && seedCuota > 0));
  const seedStartIso = syncedLoan
    ? displayToIso(syncedLoan.date) || todayIso()
    : loan
      ? displayToIso(loan.date) || todayIso()
      : todayIso();
  const seedFirstCobro = loan
    ? displayToIso(loan.schedule?.[0]?.date || "") ||
      firstCollectionIso(seedStartIso, loan.frequency ?? "diario")
    : "";
  const autoSeedFirstCobro = firstCollectionIso(seedStartIso, seedFreq);
  const [cobroIso, setCobroIso] = useState(seedFirstCobro || autoSeedFirstCobro);
  const cobroTouchedRef = useRef(
    Boolean(seedFirstCobro && autoSeedFirstCobro && seedFirstCobro !== autoSeedFirstCobro),
  );
  const [dueIso, setDueIso] = useState(
    loan
      ? displayToIso(loan.due) ||
          displayToIso(loan.schedule?.[loan.schedule.length - 1]?.date || "") ||
          ""
      : "",
  );
  /** Vencimiento sigue el cronograma hasta que el usuario lo edite a mano. */
  const dueTouchedRef = useRef(false);
  const seedTotal =
    syncedLoan?.total && syncedLoan.total > 0
      ? syncedLoan.total
      : loan?.total && loan.total > 0
        ? loan.total
        : 0;
  const [totalRaw, setTotalRaw] = useState(seedTotal > 0 ? String(seedTotal) : "");
  const totalTouchedRef = useRef(false);
  const [startIso, setStartIso] = useState(seedStartIso);
  const [notes, setNotes] = useState(() =>
    stripFundedMarkers(syncedLoan?.notes ?? loan?.notes ?? ""),
  );
  const [fundedBy, setFundedBy] = useState<LoanDisbursementSource>(() => {
    if (loan) return loanDisbursementSource(loan) ?? "nequi";
    return "nequi";
  });
  const [askingDelete, setAskingDelete] = useState(false);
  const driversReadyRef = useRef(false);
  const scheduleDriversRef = useRef({
    startIso: seedStartIso,
    frequency: seedFreq,
    termDays: seedDays,
    cuotasCount: seedCuotas,
    capital: seedCapital,
    interest: seedInterest,
  });

  const suggestions = useMemo(
    () =>
      clients
        .filter((row) => isOperationalClient(row) && matchesClient(row, query))
        .slice()
        .sort(sortClientsLikeListado),
    [clients, query],
  );
  const showList = !client;
  const capital = parseMoney(capitalRaw);
  const interestFromPct =
    interestMode === "pct" && ratePct != null && capital > 0
      ? Math.trunc((capital * ratePct) / 100)
      : 0;
  const interestFromAmount = interestMode === "amount" ? parseMoney(interestRaw) : 0;
  const interestAuto = interestMode === "pct" ? interestFromPct : interestFromAmount;
  const totalManual = parseMoney(totalRaw);
  const interest =
    totalTouchedRef.current && totalManual > capital
      ? totalManual - capital
      : interestAuto;
  const totalDue =
    totalTouchedRef.current && totalManual > 0 ? totalManual : capital + interestAuto;
  const termDays = parsePositiveInt(termDaysRaw);
  const cuotasCount = parsePositiveInt(cuotasRaw);
  const cuotaManual = parseMoney(cuotaRaw);
  const autoFirstCobroIso = firstCollectionIso(startIso, frequency);
  // Lo que está en la casilla manda (hoy = cobro hoy); no solo si “tocó” el campo.
  const firstCobroForPreview = cobroIso || undefined;
  const dueForPreview = dueTouchedRef.current && dueIso ? dueIso : undefined;
  const previewInput = {
    capital,
    interest,
    startIso,
    frequency,
    installments: cuotasCount > 0 ? cuotasCount : undefined,
    termDays: termDays > 0 ? termDays : undefined,
    firstCollectionIso: firstCobroForPreview,
    dueIso: dueForPreview,
  };
  const autoPreview = previewLoanFlat(previewInput);
  const preview =
    cuotaTouchedRef.current && cuotaManual > 0
      ? previewLoanFlat({
          ...previewInput,
          installmentAmount: cuotaManual,
        })
      : autoPreview;
  const frequencyLabel =
    PAY_FREQUENCIES.find((item) => item.id === frequency)?.label ?? "Diario";
  const termLabel = termDays > 0 ? `${termDays} días` : "—";
  const autoDueIso = preview?.dates.length ? preview.dates[preview.dates.length - 1] : "";
  const dueLabel = dueTouchedRef.current
    ? dueIso
      ? isoToDisplay(dueIso)
      : "—"
    : autoDueIso
      ? isoToDisplay(autoDueIso)
      : "—";
  const interestSelectValue =
    interestMode === "amount"
      ? parseMoney(interestRaw) === 0
        ? "0"
        : "amount"
      : ratePct != null
        ? String(ratePct)
        : "";
  const cuotaDisplay = cuotaTouchedRef.current
    ? cuotaRaw
    : autoPreview
      ? String(autoPreview.installment)
      : "";
  const totalDisplay = totalTouchedRef.current
    ? totalRaw
    : totalDue > 0
      ? String(totalDue)
      : "";
  const cobroDisplay = cobroTouchedRef.current ? cobroIso : cobroIso || autoFirstCobroIso;

  useEffect(() => {
    // En edición el # de cuotas guardado manda; en alta solo auto hasta que el usuario toque.
    if (editing || cuotasTouchedRef.current) return;
    if (termDays < 1) return;
    setCuotasRaw(String(suggestedInstallmentsForDays(frequency, termDays)));
  }, [editing, frequency, termDays]);

  // Al cambiar desembolso / plazo / cuotas / montos: volver a cálculo automático
  // (si el usuario editó a mano un campo hijo, solo se respeta hasta el próximo cambio de motor).
  useEffect(() => {
    const next = {
      startIso,
      frequency,
      termDays,
      cuotasCount,
      capital,
      interest: interestAuto,
    };
    if (!driversReadyRef.current) {
      driversReadyRef.current = true;
      scheduleDriversRef.current = next;
      return;
    }
    const prev = scheduleDriversRef.current;
    const desembolsoChanged = prev.startIso !== next.startIso || prev.frequency !== next.frequency;
    const termChanged =
      prev.termDays !== next.termDays ||
      prev.cuotasCount !== next.cuotasCount ||
      prev.frequency !== next.frequency;

    if (desembolsoChanged) {
      cobroTouchedRef.current = false;
    }
    if (termChanged || desembolsoChanged) {
      dueTouchedRef.current = false;
    }
    // Valor cuota manual: NUNCA se limpia por cambio de motor (pedido del cliente).
    scheduleDriversRef.current = next;
  }, [startIso, frequency, termDays, cuotasCount, capital, interestAuto]);

  useEffect(() => {
    if (cuotaTouchedRef.current) return;
    if (!autoPreview?.installment) return;
    setCuotaRaw(String(autoPreview.installment));
  }, [autoPreview?.installment]);

  useEffect(() => {
    if (cobroTouchedRef.current) return;
    if (!autoFirstCobroIso) return;
    setCobroIso(autoFirstCobroIso);
  }, [autoFirstCobroIso]);

  useEffect(() => {
    if (dueTouchedRef.current) return;
    if (!autoDueIso) return;
    setDueIso(autoDueIso);
  }, [autoDueIso]);

  useEffect(() => {
    if (totalTouchedRef.current) return;
    const auto = capital + interestAuto;
    if (auto > 0) setTotalRaw(String(auto));
  }, [capital, interestAuto]);

  function onInterestSelect(value: string) {
    if (!value || value === "0") {
      setInterestMode("amount");
      setRatePct(null);
      setInterestRaw("0");
      return;
    }
    if (value === "amount") {
      setInterestMode("amount");
      setRatePct(null);
      setInterestRaw((prev) => (prev.trim() ? prev : "0"));
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
  }

  function clearClient() {
    setClient(null);
    setQuery("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !preview) return;
    onSave({
      clientRef: client.ref,
      capital,
      date: isoToDisplay(startIso),
      due: dueLabel === "—" ? isoToDisplay(preview.dates[preview.dates.length - 1] || "") : dueLabel,
      notes: stripFundedMarkers(notes),
      rate: interestMode === "pct" ? ratePct ?? 0 : 0,
      frequency,
      mode: "cuota_fija",
      pact: "valor",
      days: preview.days,
      // Incluye interés 0 y el cronograma exacto (# cuotas manual).
      interest: preview.interest,
      total: preview.total,
      installment: preview.installment,
      schedule: preview.schedule,
      fundedBy,
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
              placeholder="Buscar: posición o nombre (igual que en Clientes)"
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {showList ? (
            <div className="table-wrap loan-client-pick-list" role="listbox">
              <table className="data list-grid">
                <thead>
                  <tr className="col-titles">
                    <th style={{ width: 52 }}>#</th>
                    <th className="is-nombre">Nombre</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.length === 0 ? (
                    <tr>
                      <td colSpan={2}>
                        No hay clientes con ese dato. Créelo primero en Clientes.
                      </td>
                    </tr>
                  ) : (
                    suggestions.map((row) => (
                      <tr
                        key={row.ref}
                        role="option"
                        tabIndex={0}
                        className="loan-client-pick-row"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => pick(row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            pick(row);
                          }
                        }}
                      >
                        <td>{row.routeOrder || "—"}</td>
                        <td className="is-nombre">
                          <span className="cell-with-ico">
                            <PersonMiniIcon />
                            {clientPickDisplayName(row)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
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
              {clientPickDisplayName(client)}
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
                    title="Interés 0 es válido y se guarda"
                  >
                    <option value="0">0 (sin interés)</option>
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
                      value={money(interestFromPct)}
                      readOnly
                      tabIndex={-1}
                      aria-label="Valor del interés calculado"
                      placeholder="$ interés"
                    />
                  ) : (
                    <input
                      id="loan-interest"
                      className="loan-interest-amount-input"
                      value={interestRaw}
                      onChange={(event) => onAmountChange(event.target.value)}
                      inputMode="numeric"
                      placeholder="0"
                      title="Monto de interés (0 permitido y se guarda)"
                    />
                  )}
                  <label className="sheet-label" htmlFor="loan-total">
                    Total
                  </label>
                  <input
                    id="loan-total"
                    className="loan-total-input"
                    value={totalDisplay}
                    onChange={(event) => {
                      const next = event.target.value.replace(/[^\d]/g, "");
                      if (!next) {
                        totalTouchedRef.current = false;
                        setTotalRaw("");
                        return;
                      }
                      totalTouchedRef.current = true;
                      setTotalRaw(next);
                    }}
                    inputMode="numeric"
                    title="Capital + interés (editable a mano)"
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
                  <label className="sheet-label" htmlFor="loan-term-days">
                    Tiempo (días)
                  </label>
                  <input
                    id="loan-term-days"
                    value={termDaysRaw}
                    onChange={(event) => setTermDaysRaw(event.target.value.replace(/[^\d]/g, ""))}
                    required
                    inputMode="numeric"
                    min={1}
                    placeholder="Ej. 30"
                    title="Plazo del préstamo en días"
                  />
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
                    value={cuotasRaw}
                    onChange={(event) => {
                      cuotasTouchedRef.current = true;
                      setCuotasRaw(event.target.value.replace(/[^\d]/g, ""));
                    }}
                    required
                    inputMode="numeric"
                    min={1}
                    placeholder="Ej. 26"
                    title="Cantidad de cobros del acuerdo"
                  />
                  <label className="sheet-label" htmlFor="loan-cobro-dia">
                    Día de cobro
                  </label>
                  <input
                    id="loan-cobro-dia"
                    type="date"
                    value={cobroDisplay}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!next) {
                        cobroTouchedRef.current = false;
                        setCobroIso("");
                        return;
                      }
                      cobroTouchedRef.current = true;
                      setCobroIso(next);
                    }}
                    title={
                      frequency === "diario"
                        ? "Por defecto: mismo día del desembolso (lun–sáb). Editable a mano."
                        : "Primer cobro automático según frecuencia; editable a mano"
                    }
                  />
                  <label className="sheet-label" htmlFor="loan-cuota-valor">
                    Valor cuota
                  </label>
                  <input
                    id="loan-cuota-valor"
                    value={cuotaDisplay}
                    onChange={(event) => {
                      const next = event.target.value.replace(/[^\d]/g, "");
                      if (!next) {
                        cuotaTouchedRef.current = false;
                        setCuotaRaw("");
                        return;
                      }
                      cuotaTouchedRef.current = true;
                      setCuotaRaw(next);
                    }}
                    inputMode="numeric"
                    placeholder="Monto ÷ cuotas"
                    title="Se calcula solo; puede editarlo a mano"
                  />
                </div>

                <div className="sheet-row loan-meta-row">
                  <div className="loan-meta-field">
                    <label className="sheet-label" htmlFor="loan-due">
                      Vencimiento
                    </label>
                    <input
                      id="loan-due"
                      type="date"
                      value={dueTouchedRef.current ? dueIso : dueIso || autoDueIso}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next) {
                          dueTouchedRef.current = false;
                          setDueIso("");
                          return;
                        }
                        dueTouchedRef.current = true;
                        setDueIso(next);
                      }}
                      title="Última cuota (automática; editable a mano)"
                    />
                  </div>
                  <div className="loan-meta-field">
                    <label className="sheet-label" htmlFor="loan-funded-by">
                      Origen
                    </label>
                    <select
                      id="loan-funded-by"
                      value={fundedBy}
                      onChange={(event) =>
                        setFundedBy(event.target.value as LoanDisbursementSource)
                      }
                      title={
                        fundedBy === "efectivo"
                          ? "Se descuenta del efectivo / En caja del cobrador de la ruta"
                          : "Origen del desembolso"
                      }
                    >
                      <option value="nequi">Nequi</option>
                      <option value="banco">Banco</option>
                      <option value="efectivo">Efectivo (caja cobrador)</option>
                    </select>
                  </div>
                  <div className="loan-meta-field">
                    <label className="sheet-label" htmlFor="loan-notes">
                      Observaciones
                    </label>
                    <input
                      id="loan-notes"
                      placeholder="Nota interna, opcional"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </div>
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
                Complete capital, interés, días y # de cuotas para ver el resumen.
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
