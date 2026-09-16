import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/oscillators/timezones.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", compiled)(module, module.exports);
const { initialTimeZoneState, getTimeZoneState, resolveTimeZone, formatTimestamp, isSignalToday, TIME_ZONE_STORAGE_KEY } = module.exports;
const NativeDateTimeFormat = Intl.DateTimeFormat;

function browserZone(t, timeZone) {
  t.mock.method(Intl, "DateTimeFormat", function (...args) {
    const formatter = new NativeDateTimeFormat(...args);
    if (!args[1]?.timeZone) {
      const options = formatter.resolvedOptions();
      Object.defineProperty(formatter, "resolvedOptions", { value: () => ({ ...options, timeZone }) });
    }
    return formatter;
  });
}

test("initial timezone state is deterministic and safe before browser hydration", (t) => {
  browserZone(t, "America/New_York");
  assert.deepEqual(initialTimeZoneState(), { preference: "auto", browserTimeZone: "UTC", options: ["UTC"] });
  assert.equal(resolveTimeZone(initialTimeZoneState()), "UTC");
  assert.equal(TIME_ZONE_STORAGE_KEY, "arbitra.oscillators.timeZone");
});

test("browser detection defaults to automatic and preserves only shortlisted saved choices", (t) => {
  browserZone(t, "America/New_York");
  t.mock.method(Intl, "supportedValuesOf", () => ["America/New_York", "Europe/London"]);
  const automatic = getTimeZoneState();
  assert.equal(automatic.preference, "auto");
  assert.equal(automatic.browserTimeZone, "America/New_York");
  assert.equal(resolveTimeZone(automatic), "America/New_York");
  assert.ok(automatic.options.includes("UTC"));
  assert.ok(automatic.options.includes("America/New_York"));
  assert.equal(new Set(automatic.options).size, automatic.options.length);
  const saved = getTimeZoneState("Europe/London");
  assert.equal(saved.preference, "Europe/London");
  assert.ok(saved.options.includes("Europe/London"));
  assert.equal(resolveTimeZone(saved), "Europe/London");
  for (const preference of [null, "auto", "", "Not/A_Zone", "Pacific/Auckland", "Asia/Tokyo"]) {
    const state = getTimeZoneState(preference);
    assert.equal(state.preference, "auto");
    assert.deepEqual(state.options, automatic.options);
  }
});

test("the regional shortlist is bounded and never enumerates the global timezone list", (t) => {
  browserZone(t, "America/New_York");
  t.mock.method(Intl, "supportedValuesOf", () => { throw new RangeError("Not supported by this browser"); });
  const state = getTimeZoneState("Europe/Paris");
  for (const zone of ["UTC", "America/New_York", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu",
    "Europe/London", "Europe/Paris", "America/Costa_Rica", "America/Panama", "America/Bogota",
    "America/Sao_Paulo", "America/Argentina/Buenos_Aires"]) assert.ok(state.options.includes(zone));
  assert.equal(state.options.length, 30);
  assert.equal(state.options[0], "UTC");
  assert.equal(resolveTimeZone(state), "Europe/Paris");
  assert.equal(Intl.supportedValuesOf.mock.callCount(), 0);
  for (const zone of ["Asia/Tokyo", "Australia/Sydney", "Africa/Johannesburg", "Pacific/Auckland"])
    assert.ok(!state.options.includes(zone));
});

test("an out-of-region browser still works automatically without expanding manual choices", (t) => {
  browserZone(t, "Asia/Tokyo");
  for (const saved of [undefined, "auto", "Asia/Tokyo"]) {
    const state = getTimeZoneState(saved);
    assert.equal(state.preference, "auto");
    assert.equal(resolveTimeZone(state), "Asia/Tokyo");
    assert.ok(!state.options.includes("Asia/Tokyo"));
    assert.equal(state.options.length, 30);
  }
});

test("saved timezone aliases resolve to the corresponding shortlisted choice", () => {
  assert.equal(getTimeZoneState("America/Buenos_Aires").preference, "America/Argentina/Buenos_Aires");
  assert.equal(getTimeZoneState("US/Eastern").preference, "America/New_York");
});

test("UTC formatting preserves canonical text and invalid inputs stay unavailable", () => {
  assert.equal(formatTimestamp("2026-09-14T12:34:56.123Z", "UTC"), "2026-09-14 12:34:56 UTC");
  assert.equal(formatTimestamp("2026-09-14T08:34:56-04:00", "UTC"), "2026-09-14 12:34:56 UTC");
  for (const value of [null, undefined, "", "not-a-timestamp"]) assert.equal(formatTimestamp(value, "UTC"), "—");
  assert.equal(formatTimestamp("2026-09-14T12:00:00Z", "Not/A_Zone"), "—");
});

test("AM/PM card formatting preserves midnight, noon, local dates and explicit input offsets", () => {
  for (const [value, zone, expected] of [
    ["2026-09-14T00:00:00Z", "UTC", "2026-09-14 12:00:00 AM UTC"],
    ["2026-09-14T12:00:00Z", "UTC", "2026-09-14 12:00:00 PM UTC"],
    ["2026-09-14T03:59:59Z", "America/New_York", "2026-09-13 11:59:59 PM UTC-04:00"],
    ["2026-09-14T04:00:00Z", "America/New_York", "2026-09-14 12:00:00 AM UTC-04:00"],
    ["2026-09-14T20:45:00Z", "Asia/Kathmandu", "2026-09-15 02:30:00 AM UTC+05:45"],
    ["2026-09-14T08:34:56-04:00", "UTC", "2026-09-14 12:34:56 PM UTC"],
  ]) assert.equal(formatTimestamp(value, zone, "h12"), expected);
  for (const value of [null, undefined, "", "not-a-timestamp", "2026-09-14T12:00:00"])
    assert.equal(formatTimestamp(value, "UTC", "h12"), "—");
  assert.equal(formatTimestamp("2026-09-14T12:00:00Z", "Not/A_Zone", "h12"), "—");
});

test("AM/PM preserves the date-specific offset through skipped and repeated DST hours", () => {
  for (const [value, expected] of [
    ["2026-03-08T06:59:59Z", "2026-03-08 01:59:59 AM UTC-05:00"],
    ["2026-03-08T07:00:00Z", "2026-03-08 03:00:00 AM UTC-04:00"],
    ["2026-11-01T05:30:00Z", "2026-11-01 01:30:00 AM UTC-04:00"],
    ["2026-11-01T06:30:00Z", "2026-11-01 01:30:00 AM UTC-05:00"],
  ]) assert.equal(formatTimestamp(value, "America/New_York", "h12"), expected);
});

test("New York uses the timestamp's DST offset on both transition boundaries", () => {
  for (const [value, expected] of [
    ["2026-03-08T06:59:59Z", "2026-03-08 01:59:59 UTC-05:00"],
    ["2026-03-08T07:00:00Z", "2026-03-08 03:00:00 UTC-04:00"],
    ["2026-11-01T05:59:59Z", "2026-11-01 01:59:59 UTC-04:00"],
    ["2026-11-01T06:00:00Z", "2026-11-01 01:00:00 UTC-05:00"],
  ]) assert.equal(formatTimestamp(value, "America/New_York"), expected);
});

test("fractional-offset zones and local date rollover format without changing the instant", () => {
  const value = "2026-09-14T20:45:00Z";
  assert.equal(formatTimestamp(value, "Asia/Kolkata"), "2026-09-15 02:15:00 UTC+05:30");
  assert.equal(formatTimestamp(value, "Asia/Kathmandu"), "2026-09-15 02:30:00 UTC+05:45");
  assert.equal(formatTimestamp(value, "UTC"), "2026-09-14 20:45:00 UTC");
});

test("signal-day classification uses the selected calendar day, including its exact midnight", () => {
  const now = Date.parse("2026-09-14T00:30:00Z");
  assert.equal(isSignalToday("2026-09-13T23:45:00Z", "UTC", now), false);
  assert.equal(isSignalToday("2026-09-13T23:45:00Z", "America/New_York", now), true);
  assert.equal(isSignalToday("2026-09-13T20:15:00-04:00", "UTC", now), true);
  const midnight = Date.parse("2026-09-14T04:00:00Z");
  assert.equal(isSignalToday("2026-09-14T03:59:59Z", "America/New_York", midnight), false);
  assert.equal(isSignalToday("2026-09-14T04:00:00Z", "America/New_York", midnight), true);
});

test("DST changes preserve calendar-day identity while future and invalid signals are excluded", () => {
  const autumn = Date.parse("2026-11-01T06:30:00Z");
  assert.equal(isSignalToday("2026-11-01T05:30:00Z", "America/New_York", autumn), true);
  assert.equal(isSignalToday("2026-11-01T06:30:00.001Z", "America/New_York", autumn), false);
  assert.equal(isSignalToday("2026-03-08T06:59:59Z", "America/New_York", Date.parse("2026-03-08T07:15:00Z")), true);
  for (const value of [null, undefined, "", "not-a-date", "2026-11-01T01:30:00"]) {
    assert.equal(isSignalToday(value, "America/New_York", autumn), false);
  }
  assert.equal(isSignalToday("2026-11-01T05:30:00Z", "Not/A_Zone", autumn), false);
  assert.equal(isSignalToday("2026-11-01T05:30:00Z", "UTC", NaN), false);
});
