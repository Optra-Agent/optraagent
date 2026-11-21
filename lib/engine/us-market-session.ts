type NewYorkDate = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

function newYorkDate(value: string): NewYorkDate | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday") ?? "");
  const result = {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: weekdayIndex,
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekdayOfMonth = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((lastWeekdayOfMonth - weekday + 7) % 7);
}

function observedFixedHoliday(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function easterSunday(year: number): { month: number; day: number } {
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
  return { month, day };
}

function key(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function holidayDates(year: number): Set<string> {
  const easter = easterSunday(year);
  const goodFriday = new Date(Date.UTC(year, easter.month - 1, easter.day - 2));
  return new Set([
    observedFixedHoliday(year, 1, 1),
    key(year, 1, nthWeekday(year, 1, 1, 3)),
    key(year, 2, nthWeekday(year, 2, 1, 3)),
    key(year, goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()),
    key(year, 5, lastWeekday(year, 5, 1)),
    ...(year >= 2022 ? [observedFixedHoliday(year, 6, 19)] : []),
    observedFixedHoliday(year, 7, 4),
    key(year, 9, nthWeekday(year, 9, 1, 1)),
    key(year, 11, nthWeekday(year, 11, 4, 4)),
    observedFixedHoliday(year, 12, 25),
  ]);
}

function isEarlyClose(date: NewYorkDate): boolean {
  const dateKey = key(date.year, date.month, date.day);
  const thanksgiving = nthWeekday(date.year, 11, 4, 4);
  if (date.month === 11 && date.day === thanksgiving + 1) return true;
  if (date.month === 12 && date.day === 24 && date.weekday !== 0 && date.weekday !== 6) return true;
  if (date.month === 7 && date.day === 3 && date.weekday !== 0 && date.weekday !== 6) return true;
  const july4 = new Date(Date.UTC(date.year, 6, 4));
  if (july4.getUTCDay() === 1 && dateKey === key(date.year, 7, 2)) return true;
  return false;
}

export function isRegularEquitySession(timestamp: string): boolean {
  const local = newYorkDate(timestamp);
  if (!local || local.weekday === 0 || local.weekday === 6) return false;
  if (holidayDates(local.year).has(key(local.year, local.month, local.day))) return false;
  const minuteOfDay = local.hour * 60 + local.minute;
  const closeMinute = isEarlyClose(local) ? 13 * 60 : 16 * 60;
  return minuteOfDay >= 9 * 60 + 30 && minuteOfDay < closeMinute;
}

export function isUsMarketDay(year: number, month: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidayDates(year).has(key(year, month, day));
}

/** The UTC instant of a wall-clock time in America/New_York (daylight saving aware). */
export function easternWallClockToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  for (const offsetHours of [4, 5]) {
    const candidate = Date.UTC(year, month - 1, day, hour + offsetHours, minute);
    const local = newYorkDate(new Date(candidate).toISOString());
    if (local && local.year === year && local.month === month && local.day === day && local.hour === hour && local.minute === minute) return candidate;
  }
  throw new RangeError("The requested America/New_York wall-clock time does not exist.");
}

/** Regular-session close (16:00 ET, or 13:00 ET on an early-close day) as a UTC instant. */
export function usMarketCloseUtcMs(year: number, month: number, day: number): number {
  const early = isEarlyClose({ year, month, day, hour: 0, minute: 0, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() });
  return easternWallClockToUtcMs(year, month, day, early ? 13 : 16, 0);
}

/** The America/New_York calendar date (`YYYY-MM-DD`) of an instant. */
export function easternDateKey(timestampMs: number): string {
  const local = newYorkDate(new Date(timestampMs).toISOString());
  if (!local) throw new RangeError("Invalid timestamp.");
  return key(local.year, local.month, local.day);
}
