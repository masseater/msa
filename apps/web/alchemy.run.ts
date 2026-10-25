import { Stack } from "alchemy";
import { providers, state } from "alchemy/Cloudflare";
import { Effect } from "effect";

import APP_NAME from "./app-name.ts";
import ciTelemetry from "./ci-telemetry.ts";

export default Stack(
  APP_NAME,
  { providers: providers(), state: state() },
  Effect.gen(function* stack() {
    const { url } = yield* ciTelemetry;
    return { url };
  }),
);
