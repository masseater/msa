import { Workers } from "alchemy/Cloudflare";
import { Config, Effect, Schema } from "effect";

import CI_TELEMETRY_AUDIENCE from "./ci-telemetry-audience.ts";

const COMPATIBILITY = { date: "2026-08-25" } as const;

const ciTelemetry = Effect.gen(function* ciTelemetry() {
  const GITHUB_REPOSITORY = yield* Config.schema(Schema.String, "GITHUB_REPOSITORY").pipe(
    Config.withDefault(""),
  );
  return yield* Workers.Worker("CiTelemetry", {
    compatibility: COMPATIBILITY,
    env: { GITHUB_REPOSITORY },
    logpush: true,
    main: "./ci-telemetry.worker.ts",
    name: CI_TELEMETRY_AUDIENCE,
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: false, persist: true },
    },
  });
});

export default ciTelemetry;
