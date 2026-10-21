import { DateTime, Effect } from "effect";

import type reportZoneTypes from "./report-zone.types.ts";

const REPORT_TIME_ZONE = "Europe/Berlin";

const reportZone: Effect.Effect<reportZoneTypes.ReportZone> = Effect.gen(function* () {
  const zone = yield* DateTime.zoneMakeNamedEffect(REPORT_TIME_ZONE).pipe(Effect.orDie);
  const zoned = (ms: number) => DateTime.setZone(DateTime.makeUnsafe(ms), zone);
  return {
    day: (ms: number) => DateTime.formatIsoDate(zoned(ms)),
    hour: (ms: number) => `${String(DateTime.toParts(zoned(ms)).hour).padStart(2, "0")}:00`,
    week: (ms: number) =>
      DateTime.formatIsoDate(DateTime.startOf(zoned(ms), "week", { weekStartsOn: 1 })),
  };
});

const reportZoneModule = {
  REPORT_TIME_ZONE,
  reportZone,
};

export default reportZoneModule;
