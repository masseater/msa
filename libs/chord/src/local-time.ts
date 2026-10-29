import { Clock, DateTime, Effect, Option } from "effect";

import type localTimeTypes from "./local-time.types.ts";

const TOKENS = /YYYY|YY|MM|M|DD|D|HH|mm|ss/gu;

const pad = (value: number): string => String(value).padStart(2, "0");

const zoned = (value: string | number): DateTime.Zoned =>
  DateTime.makeZonedUnsafe(
    Option.getOrElse(DateTime.make(value), () => DateTime.makeUnsafe(0)),
    { timeZone: DateTime.zoneMakeLocal() },
  );

const format = (value: string | number, layout: string): string => {
  const parts = DateTime.toParts(zoned(value));
  const year = String(parts.year);
  const fields: Readonly<Record<string, string>> = {
    D: String(parts.day),
    DD: pad(parts.day),
    HH: pad(parts.hour),
    M: String(parts.month),
    MM: pad(parts.month),
    YY: year.slice(-2),
    YYYY: year,
    mm: pad(parts.minute),
    ss: pad(parts.second),
  };
  return layout.replaceAll(TOKENS, (token) => fields[token] ?? token);
};

const zone = (): localTimeTypes.LocalTimeZone => ({
  name: DateTime.zoneToString(DateTime.zoneMakeLocal()),
  offset: DateTime.zonedOffsetIso(zoned(Effect.runSync(Clock.currentTimeMillis))),
});

const dayStart = (value: number, days: number): number =>
  DateTime.toEpochMillis(DateTime.add(DateTime.startOf(zoned(value), "day"), { days }));

const localTime = { dayStart, format, zone };

export default localTime;
