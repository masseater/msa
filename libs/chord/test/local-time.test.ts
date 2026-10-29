import testing from "@msa/testing";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const { runNodeScript, runTest } = testing;

const localTimeUrl = new URL("../src/local-time.ts", import.meta.url).href;

const INSTANT = Date.UTC(2026, 0, 1, 0, 4, 5);

const PROBE = `
import localTime from ${JSON.stringify(localTimeUrl)};

const at = ${INSTANT};
process.stdout.write(JSON.stringify({
  dateTime: localTime.format(at, "YYYY-MM-DD HH:mm"),
  dayStart: localTime.dayStart(at, -1),
  fileName: localTime.format(at, "YYYY-MM-DD_HH-mm-ss"),
  isoString: localTime.format(new Date(at).toISOString(), "YYYY-MM-DD HH:mm"),
  short: localTime.format(at, "YY/M/D HH:mm"),
  zone: localTime.zone(),
}));
`;

const decodeProbe = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      dateTime: Schema.String,
      dayStart: Schema.Finite,
      fileName: Schema.String,
      isoString: Schema.String,
      short: Schema.String,
      zone: Schema.Struct({ name: Schema.String, offset: Schema.String }),
    }),
  ),
);

const inTimeZone = (timeZone: string) =>
  Effect.gen(function* () {
    const result = yield* runNodeScript(PROBE, { env: { TZ: timeZone } });
    expect(result.code, result.stderr).toBe(0);
    return yield* decodeProbe(result.stdout).pipe(Effect.orDie);
  });

describe("local time", () => {
  it("writes each layout in the zone the process started with", () =>
    runTest(
      Effect.gen(function* () {
        const tokyo = yield* inTimeZone("Asia/Tokyo");
        const saoPaulo = yield* inTimeZone("America/Sao_Paulo");

        expect(tokyo).toEqual({
          dateTime: "2026-01-01 09:04",
          dayStart: Date.UTC(2025, 11, 30, 15),
          fileName: "2026-01-01_09-04-05",
          isoString: "2026-01-01 09:04",
          short: "26/1/1 09:04",
          zone: { name: "Asia/Tokyo", offset: "+09:00" },
        });
        expect(saoPaulo).toEqual({
          dateTime: "2025-12-31 21:04",
          dayStart: Date.UTC(2025, 11, 30, 3),
          fileName: "2025-12-31_21-04-05",
          isoString: "2025-12-31 21:04",
          short: "25/12/31 21:04",
          zone: { name: "America/Sao_Paulo", offset: "-03:00" },
        });
      }),
    ));
});
