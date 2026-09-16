/** Presentation-only timezone preferences; API timestamps remain UTC instants. */
export const TIME_ZONE_STORAGE_KEY = "arbitra.oscillators.timeZone";

export type TimeZoneState = {
  preference: string;
  browserTimeZone: string;
  options: string[];
};

/** Stable server/first-client state; browser detection happens after mounting. */
export function initialTimeZoneState(): TimeZoneState {
  return { preference: "auto", browserTimeZone: "UTC", options: ["UTC"] };
}

function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Common regional choices, ordered by region rather than enumerating every city. */
const commonTimeZones = [
  "UTC",
  // USA: Eastern, Central, Mountain, Pacific, Arizona, Alaska and Hawaii.
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu",
  // Europe.
  "Europe/London", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin",
  "Europe/Madrid", "Europe/Rome", "Europe/Athens",
  // Central America.
  "America/Guatemala", "America/Belize", "America/El_Salvador", "America/Tegucigalpa",
  "America/Managua", "America/Costa_Rica", "America/Panama",
  // South America.
  "America/Bogota", "America/Lima", "America/Caracas", "America/La_Paz",
  "America/Santiago", "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "America/Montevideo",
] as const;

/** Browser automatic mode is unrestricted; manual options stay in the regional shortlist. */
export function getTimeZoneState(savedPreference?: string | null): TimeZoneState {
  let browserTimeZone = "UTC";
  try {
    browserTimeZone = canonicalTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
  } catch { /* UTC is the safe display fallback when detection is unavailable. */ }
  const saved = savedPreference === "auto" ? null : canonicalTimeZone(savedPreference);
  const options = commonTimeZones.filter((zone) => canonicalTimeZone(zone) !== null);
  // Match aliases without adding a removed saved zone back into the menu.
  const preference = saved ? options.find((zone) => canonicalTimeZone(zone) === saved) ?? "auto" : "auto";
  return { preference, browserTimeZone, options };
}

export function resolveTimeZone(state: TimeZoneState): string {
  return state.preference === "auto" ? state.browserTimeZone : state.preference;
}

/** Include the date-specific UTC offset so DST's repeated wall times differ. */
export function formatTimestamp(value: string | null | undefined, timeZone: string): string {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) return "—";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      timeZoneName: "longOffset",
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
    const offset = part("timeZoneName").replace(/^GMT/, "UTC").replace(/^UTC[+-]00:00$/, "UTC");
    return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} ${offset}`;
  } catch {
    return "—";
  }
}

/** Use the selected zone's calendar day, not a rolling 24-hour interval. */
export function isSignalToday(value: string | null | undefined, timeZone: string, now = Date.now()): boolean {
  if (!value || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime()) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now) return false;
  const signalDate = formatTimestamp(value, timeZone);
  const currentDate = formatTimestamp(new Date(now).toISOString(), timeZone);
  return signalDate !== "—" && currentDate !== "—" && signalDate.slice(0, 10) === currentDate.slice(0, 10);
}
