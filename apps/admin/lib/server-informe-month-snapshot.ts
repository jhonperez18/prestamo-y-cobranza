/**
 * Arma el informe General y el de Angélica con las mismas funciones que la pantalla.
 * No escribe caja, CIE ni Inicial. Solo devuelve la copia que se guarda.
 */
import { sameRoute } from "@/lib/client-route-order";
import type { OperationalDayState } from "@/lib/collector-day-auto-close";
import { buildDayCashLedger } from "@/lib/day-cash-ledger";
import {
  bancoAcumuladoRutas,
  bancoRouteCuadre,
  digitalPoolGastos,
  digitalPoolGastosTotal,
  nequiRouteHistoryDays,
  type DigitalPoolGasto,
} from "@/lib/digital-pools";
import { pesos } from "@/lib/finance";
import { independentRouteDay } from "@/lib/independent-route-cash";
import { informeOwnRouteHistory, informeRouteHistory } from "@/lib/informe-route-days";
import {
  informeSnapshotRef,
  type InformeMonthSnapshot,
  type InformeSnapshotRow,
} from "@/lib/informe-month-snapshot";
import { isoToDisplay } from "@/lib/loan-preview";
import type { BankAccount } from "@/lib/bank";
import type { MiscPayment } from "@/lib/misc-payments";
import type { CollectorRow } from "@/lib/mock-data";
import { portfolioBalanceForClients } from "@/lib/portfolio-stats";

const GENERAL_ROUTES = ["M", "T", "N"] as const;

function collectorOf(
  state: OperationalDayState,
  routeName: string,
): CollectorRow | null {
  const route = state.routes.find((row) => sameRoute(row.name, routeName));
  if (!route?.collectorRef) return null;
  return state.collectors.find((row) => row.ref === route.collectorRef) ?? null;
}

function carteraOf(state: OperationalDayState, routeName: string) {
  const refs = new Set(
    state.clients.filter((row) => sameRoute(row.route, routeName)).map((row) => row.ref),
  );
  return portfolioBalanceForClients(state.loans, state.payments, refs);
}

function sources(state: OperationalDayState, collector: CollectorRow, date: string) {
  return {
    collectorRef: collector.ref,
    collectorName: collector.name,
    date,
    payments: state.payments,
    loans: state.loans,
    clients: state.clients,
    collectors: [collector],
    assignments: state.assignments,
    dayCloses: state.dayCloses,
    dayExpenseDrafts: state.dayExpenseDrafts,
    planillaCashCloses: state.planillaCashCloses ?? [],
    monthCloses: state.monthCloses ?? [],
  };
}

function historySources(state: OperationalDayState) {
  return {
    payments: state.payments,
    loans: state.loans,
    clients: state.clients,
    collectors: state.collectors,
    assignments: state.assignments,
    dayCloses: state.dayCloses,
    dayExpenseDrafts: state.dayExpenseDrafts,
    planillaCashCloses: state.planillaCashCloses ?? [],
    monthCloses: state.monthCloses ?? [],
  };
}

function refsOf(state: OperationalDayState, routes: readonly string[]) {
  return [
    ...new Set(
      state.routes
        .filter((row) => routes.some((pin) => sameRoute(row.name, pin)))
        .map((row) => row.collectorRef)
        .filter(Boolean),
    ),
  ];
}

export function buildInformeMonthSnapshots(input: {
  state: OperationalDayState;
  sealedOn: string;
  miscPayments: readonly MiscPayment[];
  accounts: readonly BankAccount[];
}): { general: InformeMonthSnapshot; angelica: InformeMonthSnapshot } {
  const { state, sealedOn } = input;
  const period = sealedOn.slice(0, 7);
  const from = `${period}-01`;
  const corteLabel = isoToDisplay(sealedOn);
  const chainCollector = collectorOf(state, "T") ?? collectorOf(state, "M");
  const efectivoT = chainCollector
    ? buildDayCashLedger(sources(state, chainCollector, sealedOn)).dayFinal
    : 0;
  const nCollector = collectorOf(state, "N");
  const efectivoN = nCollector
    ? independentRouteDay(sources(state, nCollector, sealedOn), "N").closing
    : 0;
  const aCollector = collectorOf(state, "A");
  const efectivoA = aCollector
    ? independentRouteDay(sources(state, aCollector, sealedOn), "A").closing
    : 0;

  const cartera = GENERAL_ROUTES.map((route) => ({
    route,
    value: carteraOf(state, route),
  }));
  const carteraTotal = cartera.reduce((sum, row) => sum + row.value, 0);
  const efectivoTotal = efectivoT + efectivoN;
  const bancoGastos = digitalPoolGastos({
    pool: "banco",
    miscPayments: input.miscPayments,
    accounts: input.accounts as BankAccount[],
    dayCloses: state.dayCloses,
    fromIso: from,
    toIso: sealedOn,
  });
  const bancoGastado = digitalPoolGastosTotal(bancoGastos);
  const banco = pesos(
    bancoAcumuladoRutas(
      GENERAL_ROUTES.map((pin) =>
        bancoRouteCuadre({
          payments: state.payments,
          loans: state.loans,
          clients: state.clients,
          dayCloses: state.dayCloses,
          dateIso: sealedOn,
          routeName: pin,
          fromIso: from,
        }),
      ),
    ) - bancoGastado,
  );
  const generalRows: InformeSnapshotRow[] = [
    { kind: "section", label: "Cartera" },
    ...cartera.map(
      (row): InformeSnapshotRow => ({ kind: "line", label: row.route, value: row.value, tone: "sub" }),
    ),
    { kind: "line", label: "Total cartera", value: carteraTotal, tone: "total" },
    { kind: "section", label: "Efectivo" },
    { kind: "line", label: "T (saldo final, incluye M)", value: efectivoT, tone: "sub" },
    { kind: "line", label: "N", value: efectivoN, tone: "sub" },
    { kind: "line", label: "Total efectivo (T + N)", value: efectivoTotal, tone: "total" },
    { kind: "section", label: "Banco" },
    { kind: "line", label: "Banco", value: banco, tone: "total" },
    { kind: "section", label: "Gran total" },
    {
      kind: "line",
      label: "Cartera + efectivo + banco",
      value: carteraTotal + efectivoTotal + banco,
      tone: "grand",
    },
  ];

  const carteraA = carteraOf(state, "A");
  const nequiGastos = digitalPoolGastos({
    pool: "nequi",
    miscPayments: input.miscPayments,
    accounts: input.accounts as BankAccount[],
    dayCloses: state.dayCloses,
    fromIso: from,
    toIso: sealedOn,
  });
  const nequiGastado = digitalPoolGastosTotal(nequiGastos);
  const nequiDays = nequiRouteHistoryDays({
    payments: state.payments,
    loans: state.loans,
    clients: state.clients,
    dayCloses: state.dayCloses,
    fromIso: from,
    toIso: sealedOn,
  });
  const nequi = pesos((nequiDays[0]?.saldo ?? 0) - nequiGastado);
  const angelicaRows: InformeSnapshotRow[] = [
    { kind: "section", label: "Cartera" },
    { kind: "line", label: "A", value: carteraA, tone: "sub" },
    { kind: "line", label: "Total cartera", value: carteraA, tone: "total" },
    { kind: "section", label: "Efectivo" },
    { kind: "line", label: "A (saldo final)", value: efectivoA, tone: "sub" },
    { kind: "line", label: "Total efectivo", value: efectivoA, tone: "total" },
    { kind: "section", label: "Nequi" },
    { kind: "line", label: "Nequi", value: nequi, tone: "total" },
    { kind: "section", label: "Gran total" },
    {
      kind: "line",
      label: "Cartera + efectivo + nequi",
      value: carteraA + efectivoA + nequi,
      tone: "grand",
    },
  ];

  const shared = historySources(state);
  const generalHistory = informeRouteHistory(shared, refsOf(state, GENERAL_ROUTES), from, sealedOn);
  const angelicaHistory = informeOwnRouteHistory(
    shared,
    refsOf(state, ["A"]),
    "A",
    from,
    sealedOn,
  );

  return {
    general: pack("general", period, sealedOn, corteLabel, generalRows, generalHistory, bancoGastos, bancoGastado),
    angelica: pack("angelica", period, sealedOn, corteLabel, angelicaRows, angelicaHistory, nequiGastos, nequiGastado),
  };
}

function pack(
  scope: InformeMonthSnapshot["scope"],
  period: string,
  sealedOn: string,
  corteLabel: string,
  rows: InformeSnapshotRow[],
  history: InformeMonthSnapshot["history"],
  poolGastos: DigitalPoolGasto[],
  poolGastado: number,
): InformeMonthSnapshot {
  return {
    ref: informeSnapshotRef(scope, period),
    scope,
    period,
    sealedOn,
    corteLabel,
    rows,
    history,
    poolGastos,
    poolGastado,
  };
}
