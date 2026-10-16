import { Effect, Schema } from "effect";

import { localBin, runCommand, runHook, writeJson } from "./env.ts";

const REPORTED_OUTPUT_LENGTH = 6000;

const StopOutput = Schema.Struct({
  decision: Schema.Literal("block"),
  reason: Schema.String,
});

runHook(
  Effect.gen(function* stopGate() {
    const verify = yield* runCommand(yield* localBin("vp"), ["run", "--log", "grouped", "verify"]);
    if (!verify.succeeded) {
      yield* writeJson(StopOutput, {
        decision: "block",
        reason: `vp run verify が失敗している。\n${verify.output.slice(-REPORTED_OUTPUT_LENGTH)}`,
      });
    }
  }),
);
