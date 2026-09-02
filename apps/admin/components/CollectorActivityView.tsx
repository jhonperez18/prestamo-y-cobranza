"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "@/components/icons";
import { CollectorActivityList } from "@/components/CollectorActivityList";
import { parseActivityWhen } from "@/lib/collector-daily-log";
import { activityFeed } from "@/lib/collector-preview";
import { todayIso } from "@/lib/daily-dispatch";
import type { ActivityRow, CollectorRow, PaymentRow } from "@/lib/mock-data";

type Period = "dia" | "semana" | "mes";

type AppliedFilters = {
  collectorRef: string;
  period: Period;
  dateFrom: string;
  dateTo: string;
  query: string;
};

type Props = {
  collectors: CollectorRow[];
  payments: PaymentRow[];
  activities: ActivityRow[];
  onOpenCollector: (ref: string) => void;
};

function startOfWeek(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function monthBounds(iso: string) {
  const [y, m] = iso.split("-");
  const start = `${y}-${m}-01`;
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  const end = `${y}-${m}-${String(last).padStart(2, "0")}`;
  return { start, end };
}

function defaultRange(period: Period, anchor: string) {
  const base = anchor || todayIso();
  if (period === "dia") return { dateFrom: base, dateTo: base };
  if (period === "semana") {
    const dateFrom = startOfWeek(base);
    return { dateFrom, dateTo: addDays(dateFrom, 6) };
  }
  const { start, end } = monthBounds(base);
  return { dateFrom: start, dateTo: end };
}

function orderedRange(dateFrom: string, dateTo: string, fallback: string) {
  const from = dateFrom || fallback;
  const to = dateTo || from;
  if (from <= to) return { start: from, end: to };
  return { start: to, end: from };
}

function isoToLabel(iso: string | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

export function CollectorActivityView({ collectors, payments, activities, onOpenCollector }: Props) {
  const today = todayIso();
  const monthDefault = defaultRange("mes", today);

  const [collectorRef, setCollectorRef] = useState("");
  const [period, setPeriod] = useState<Period>("mes");
  const [dateFrom, setDateFrom] = useState(monthDefault.dateFrom);
  const [dateTo, setDateTo] = useState(monthDefault.dateTo);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState<AppliedFilters>({
    collectorRef: "",
    period: "mes",
    dateFrom: monthDefault.dateFrom,
    dateTo: monthDefault.dateTo,
    query: "",
  });

  const range = useMemo(
    () => orderedRange(applied.dateFrom, applied.dateTo, today),
    [applied.dateFrom, applied.dateTo, today],
  );

  const feed = useMemo(
    () =>
      activityFeed(activities, payments, collectors, {
        collectorRef: applied.collectorRef || undefined,
      }),
    [activities, payments, collectors, applied.collectorRef],
  );

  const visible = useMemo(() => {
    const filtered = feed.filter((row) => {
      const parsed = parseActivityWhen(row.when);
      if (!parsed?.date) return false;
      if (parsed.date < range.start || parsed.date > range.end) return false;
      if (!applied.query) return true;
      const q = applied.query.toLowerCase();
      return (
        row.title.toLowerCase().includes(q) ||
        row.detail.toLowerCase().includes(q) ||
        row.collectorName.toLowerCase().includes(q)
      );
    });

    return filtered.map((row) => ({
      ref: row.ref,
      when: row.when,
      title: row.title,
      detail: row.detail,
      kind: row.kind,
      gps: row.gps,
      collectorName: row.collectorName,
      onCollectorClick: () => onOpenCollector(row.collectorRef),
    }));
  }, [applied.query, feed, onOpenCollector, range.end, range.start]);

  const rangeLabel =
    range.start === range.end
      ? isoToLabel(range.start)
      : `${isoToLabel(range.start)} – ${isoToLabel(range.end)}`;

  function applyFilters(next: Partial<AppliedFilters>) {
    setApplied((current) => ({ ...current, ...next }));
  }

  function changePeriod(next: Period) {
    setPeriod(next);
    const anchor = dateFrom || today;
    const nextRange = defaultRange(next, anchor);
    setDateFrom(nextRange.dateFrom);
    setDateTo(nextRange.dateTo);
    applyFilters({
      period: next,
      dateFrom: nextRange.dateFrom,
      dateTo: nextRange.dateTo,
    });
  }

  function changeDay(next: string) {
    setDateFrom(next);
    setDateTo(next);
    applyFilters({ dateFrom: next, dateTo: next });
  }

  function changeFrom(next: string) {
    if (!next) return;
    setDateFrom(next);
    applyFilters({ dateFrom: next, dateTo: dateTo || next });
  }

  function changeTo(next: string) {
    if (!next) return;
    setDateTo(next);
    applyFilters({ dateFrom: dateFrom || next, dateTo: next });
  }

  function search() {
    applyFilters({ collectorRef, period, dateFrom, dateTo, query });
  }

  function clear() {
    const reset = defaultRange("mes", today);
    setCollectorRef("");
    setPeriod("mes");
    setDateFrom(reset.dateFrom);
    setDateTo(reset.dateTo);
    setQuery("");
    setApplied({
      collectorRef: "",
      period: "mes",
      dateFrom: reset.dateFrom,
      dateTo: reset.dateTo,
      query: "",
    });
  }

  return (
    <section className="panel">
      <div className="head">
        <div className="head-title">
          <h1>Actividad</h1>
          <span className="count">{visible.length}</span>
        </div>
        <div className="grow" />
        <span className="activity-range-hint">{rangeLabel}</span>
      </div>

      <div className="filters collector-filters activity-filters">
        <select
          value={collectorRef}
          onChange={(event) => {
            const next = event.target.value;
            setCollectorRef(next);
            applyFilters({ collectorRef: next });
          }}
        >
          <option value="">Todos los cobradores</option>
          {collectors.map((row) => (
            <option key={row.ref} value={row.ref}>
              {row.name}
            </option>
          ))}
        </select>

        <select value={period} onChange={(event) => changePeriod(event.target.value as Period)}>
          <option value="dia">Día</option>
          <option value="semana">Semana</option>
          <option value="mes">Mes</option>
        </select>

        {period === "dia" ? (
          <label className="activity-date-single">
            <span>Fecha</span>
            <input type="date" value={dateFrom} onChange={(event) => changeDay(event.target.value)} />
          </label>
        ) : (
          <div className="activity-date-range">
            <label>
              <span>Desde</span>
              <input type="date" value={dateFrom} onChange={(event) => changeFrom(event.target.value)} />
            </label>
            <label>
              <span>Hasta</span>
              <input type="date" value={dateTo} onChange={(event) => changeTo(event.target.value)} />
            </label>
          </div>
        )}

        <input
          placeholder="Buscar actividad…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && search()}
        />
        <button className="go" type="button" onClick={search}>
          <SearchIcon size={15} />
        </button>
        <button className="btn ghost filter-clear" type="button" onClick={clear}>
          Limpiar
        </button>
      </div>

      <CollectorActivityList
        items={visible}
        showCollector
        emptyMessage="No hay actividad con esos filtros."
      />
    </section>
  );
}
