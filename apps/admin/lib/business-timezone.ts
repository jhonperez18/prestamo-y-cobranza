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

export function businessClockParts(now = new Date()): BusinessClockParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of dtf.formatToParts(now)) {
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
