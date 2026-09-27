/**
 * Reloj de negocio: America/Bogota.
 * Vercel corre en UTC; sin esto el corte 23:30 y el “hoy” salen mal.
 */
export const BUSINESS_TIME_ZONE = "America/Bogota";

export type BusinessClockParts = {
  dateIso: string;
  hour: number;
  minute: number;
  minutesSinceMidnight: number;
};

/** Crear un Intl.DateTimeFormat es caro (celular): uno solo por proceso. */
let businessFormatter: Intl.DateTimeFormat | null = null;

function businessClockFormatter() {
  businessFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return businessFormatter;
}

/**
 * La salida tiene resolución de minuto: se memoriza el último minuto pedido.
 * El ciclo diario lo consulta por cada visita con el mismo `now`.
 */
let lastMinuteKey = Number.NaN;
let lastParts: BusinessClockParts | null = null;

export function businessClockParts(now = new Date()): BusinessClockParts {
  const minuteKey = Math.floor(now.getTime() / 60_000);
  if (lastParts && minuteKey === lastMinuteKey) return { ...lastParts };
  const parts = formatBusinessClockParts(now);
  lastMinuteKey = minuteKey;
  lastParts = parts;
  return { ...parts };
}

function formatBusinessClockParts(now: Date): BusinessClockParts {
  const bag: Record<string, string> = {};
  for (const part of businessClockFormatter().formatToParts(now)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const hour = Number(bag.hour) || 0;
  const minute = Number(bag.minute) || 0;
  return {
    dateIso: `${bag.year}-${bag.month}-${bag.day}`,
    hour,
    minute,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

export function businessTodayIso(now = new Date()) {
  return businessClockParts(now).dateIso;
}

/** Fecha ISO (Bogotá) hace `days` días civiles. */
export function businessDaysAgoIso(days: number, now = new Date()) {
  const today = businessTodayIso(now);
  const [y, m, d] = today.split("-").map(Number);
  const utc = Date.UTC(y, (m || 1) - 1, d || 1);
  const past = new Date(utc - Math.max(0, days) * 86_400_000);
  const yy = past.getUTCFullYear();
  const mm = String(past.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(past.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
