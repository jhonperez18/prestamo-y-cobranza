/** Festivos de Colombia (fijos + Ley Emiliani + Semana Santa). */

function parts(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

function toIso(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function utcWeekday(iso: string) {
  const { year, month, day } = parts(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=dom … 6=sáb
}

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(year, month, day);
}

function addDaysIso(iso: string, days: number) {
  const { year, month, day } = parts(iso);
  return toIso(year, month, day + days);
}

/** Traslada al siguiente lunes (Ley Emiliani). */
function nextMonday(iso: string) {
  const weekday = utcWeekday(iso);
  if (weekday === 1) return iso;
  const delta = weekday === 0 ? 1 : 8 - weekday;
  return addDaysIso(iso, delta);
}

export type ColombiaHoliday = { fecha: string; nombre: string };

const holidayCache = new Map<number, Set<string>>();
const holidayListCache = new Map<number, ColombiaHoliday[]>();

/** Festivos del año, con nombre. Si dos caen el mismo día, se queda el primero. */
export function colombiaHolidayEntries(year: number): ColombiaHoliday[] {
  const cached = holidayListCache.get(year);
  if (cached) return cached;

  const easter = easterSunday(year);
  const raw: ColombiaHoliday[] = [
    { fecha: toIso(year, 1, 1), nombre: "Año Nuevo" },
    { fecha: nextMonday(toIso(year, 1, 6)), nombre: "Reyes Magos" },
    { fecha: nextMonday(toIso(year, 3, 19)), nombre: "San José" },
    { fecha: addDaysIso(easter, -3), nombre: "Jueves Santo" },
    { fecha: addDaysIso(easter, -2), nombre: "Viernes Santo" },
    { fecha: toIso(year, 5, 1), nombre: "Día del Trabajo" },
    { fecha: nextMonday(addDaysIso(easter, 39)), nombre: "Ascensión" },
    { fecha: nextMonday(addDaysIso(easter, 60)), nombre: "Corpus Christi" },
    { fecha: nextMonday(addDaysIso(easter, 71)), nombre: "Sagrado Corazón" },
    { fecha: nextMonday(toIso(year, 6, 29)), nombre: "San Pedro y San Pablo" },
    { fecha: toIso(year, 7, 20), nombre: "Independencia" },
    { fecha: toIso(year, 8, 7), nombre: "Batalla de Boyacá" },
    { fecha: nextMonday(toIso(year, 8, 15)), nombre: "Asunción" },
    { fecha: nextMonday(toIso(year, 10, 12)), nombre: "Día de la Raza" },
    { fecha: nextMonday(toIso(year, 11, 1)), nombre: "Todos los Santos" },
    { fecha: nextMonday(toIso(year, 11, 11)), nombre: "Independencia de Cartagena" },
    { fecha: toIso(year, 12, 8), nombre: "Inmaculada Concepción" },
    { fecha: toIso(year, 12, 25), nombre: "Navidad" },
  ];
  const seen = new Set<string>();
  const list: ColombiaHoliday[] = [];
  for (const row of raw) {
    if (seen.has(row.fecha)) continue;
    seen.add(row.fecha);
    list.push(row);
  }
  holidayListCache.set(year, list);
  return list;
}

export function colombiaHolidaysForYear(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const set = new Set(colombiaHolidayEntries(year).map((row) => row.fecha));
  holidayCache.set(year, set);
  return set;
}

export type CalendarClosureRow = {
  fecha: string;
  tipo: "domingo" | "festivo";
  nombre: string;
};

/** Domingos y festivos de un año. Un festivo que cae en domingo queda como festivo. */
export function calendarClosureRows(year: number): CalendarClosureRow[] {
  const holidays = new Map(colombiaHolidayEntries(year).map((row) => [row.fecha, row.nombre]));
  const rows: CalendarClosureRow[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= last; day += 1) {
      const fecha = toIso(year, month, day);
      const festivo = holidays.get(fecha);
      if (festivo) rows.push({ fecha, tipo: "festivo", nombre: festivo });
      else if (utcWeekday(fecha) === 0) rows.push({ fecha, tipo: "domingo", nombre: "Domingo" });
    }
  }
  return rows;
}

export function isColombiaHoliday(iso: string) {
  if (!iso) return false;
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return colombiaHolidaysForYear(year).has(iso);
}

/** Domingo = 0. */
export function isSunday(iso: string) {
  return utcWeekday(iso) === 0;
}

/** Cobro diario: lunes a sábado, sin festivos. */
export function isDailyCollectionDay(iso: string) {
  const day = utcWeekday(iso);
  if (day === 0) return false; // domingo
  if (isColombiaHoliday(iso)) return false;
  return true;
}

const WEEKDAY_LABELS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

export function weekdayLabel(iso: string) {
  return WEEKDAY_LABELS[utcWeekday(iso)] ?? "—";
}

export function utcWeekdayIndex(iso: string) {
  return utcWeekday(iso);
}

/** Suma días de calendario a una fecha ISO (UTC). */
export function addCalendarDaysIso(iso: string, days: number) {
  return addDaysIso(iso, days);
}

/**
 * Días de cobro (lun–sáb, sin festivos) estrictamente después de `fromIso`
 * hasta `untilIso` inclusive. Domingos y festivos no cuentan.
 */
export function countCollectionDaysAfter(fromIso: string, untilIso: string) {
  if (!fromIso || !untilIso || fromIso >= untilIso) return 0;
  let count = 0;
  let cur = addDaysIso(fromIso, 1);
  while (cur <= untilIso) {
    if (isDailyCollectionDay(cur)) count += 1;
    cur = addDaysIso(cur, 1);
  }
  return count;
}
