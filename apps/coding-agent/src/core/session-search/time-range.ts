import platform from "../platform/index.ts";

const { toEpochMs } = platform;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;
const UTC_DATE = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
  year: "numeric",
});

function nextDate(date: string): string {
  return UTC_DATE.format(toEpochMs(`${date}T00:00:00Z`) + DAY_MS);
}

function parseBound(value: string, end: boolean): number {
  const trimmed = value.trim();
  const local = DATE_ONLY.test(trimmed) ? `${end ? nextDate(trimmed) : trimmed}T00:00:00` : trimmed;
  const time = toEpochMs(local);
  if (Number.isNaN(time)) {
    throw new TypeError(
      `${end ? "until" : "since"} must be a date (YYYY-MM-DD) or an ISO 8601 date-time: ${value}`,
    );
  }
  return time;
}

function timeRange(since: string | undefined, until: string | undefined) {
  return {
    since: since === undefined ? undefined : parseBound(since, false),
    until: until === undefined ? undefined : parseBound(until, true),
  };
}

const timeRangeModule = { timeRange };

export default timeRangeModule;
