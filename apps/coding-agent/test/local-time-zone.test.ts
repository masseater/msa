import testing from "@msa/testing";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const { runNodeScript, runTest } = testing;

const sourceResolverUrl = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;
const systemPromptUrl = new URL("../src/core/system-prompt.ts", import.meta.url).href;
const platformUrl = new URL("../src/core/platform/index.ts", import.meta.url).href;

const PROBE = `
import systemPrompt from ${JSON.stringify(systemPromptUrl)};
import platform from ${JSON.stringify(platformUrl)};

process.stdout.write(JSON.stringify({
  prompt: systemPrompt.buildSystemPrompt({ cwd: "/tmp", selectedTools: [], skills: [] }),
  shown: platform.formatLocalDateTime(Date.UTC(2026, 0, 1, 0, 0)),
  stored: platform.nowIso(),
}));
`;

const decodeProbe = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ prompt: Schema.String, shown: Schema.String, stored: Schema.String }),
  ),
);

const startWithTimeZone = (timeZone: string) =>
  Effect.gen(function* () {
    const result = yield* runNodeScript(PROBE, {
      env: { TZ: timeZone },
      nodeArgs: ["--import", sourceResolverUrl],
    });
    expect(result.code, result.stderr).toBe(0);
    return yield* decodeProbe(result.stdout).pipe(Effect.orDie);
  });

describe("local time zone", () => {
  it("puts the TZ the process started with into the system prompt", () =>
    runTest(
      Effect.gen(function* () {
        const tokyo = yield* startWithTimeZone("Asia/Tokyo");
        const saoPaulo = yield* startWithTimeZone("America/Sao_Paulo");

        expect(tokyo.prompt).toContain("Asia/Tokyo (UTC+09:00)");
        expect(saoPaulo.prompt).toContain("America/Sao_Paulo (UTC-03:00)");
      }),
    ));

  it("shows times in that zone and keeps stored timestamps in UTC", () =>
    runTest(
      Effect.gen(function* () {
        const tokyo = yield* startWithTimeZone("Asia/Tokyo");
        const saoPaulo = yield* startWithTimeZone("America/Sao_Paulo");

        expect(tokyo.shown).toBe("2026-01-01 09:00");
        expect(saoPaulo.shown).toBe("2025-12-31 21:00");
        expect(tokyo.stored).toMatch(/Z$/u);
        expect(saoPaulo.stored).toMatch(/Z$/u);
      }),
    ));
});
