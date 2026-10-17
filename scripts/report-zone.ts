import { DateTime, Effect } from "effect";

const REPORT_TIME_ZONE = "Europe/Berlin";

interface ReportZone {
  readonly day: (ms: number) => string;
  readonly hour: (ms: number) => string;
  readonly week: (ms: number) => string;
}

const reportZone: Effect.Effect<ReportZone> = Effect.gen(function* () {
  const zone = yield* DateTime.zoneMakeNamedEffect(REPORT_TIME_ZONE).pipe(Effect.orDie);
  const zoned = (ms: number) => DateTime.setZone(DateTime.makeUnsafe(ms), zone);
  return {
    day: (ms: number) => DateTime.formatIsoDate(zoned(ms)),
    hour: (ms: number) => `${String(DateTime.toParts(zoned(ms)).hour).padStart(2, "0")}:00`,
    week: (ms: number) =>
      DateTime.formatIsoDate(DateTime.startOf(zoned(ms), "week", { weekStartsOn: 1 })),
  };
});

export type { ReportZone };
export { REPORT_TIME_ZONE, reportZone };
