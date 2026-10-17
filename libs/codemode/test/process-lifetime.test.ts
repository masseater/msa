import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { allLines, firstLine, isAvailable } from "./process-runner.ts";

type StopMode = "abort" | "timeout" | "close";

const runtimes = [
  { name: "Node", command: process.execPath, available: true },
  { name: "Bun", command: "bun", available: await isAvailable("bun") },
];

const runFixture = (command: string, args: string[], untilExit: boolean) =>
  Effect.promise(() => (untilExit ? allLines(command, args) : firstLine(command, args)));

const decodeResultLine = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ type: Schema.String, kind: Schema.String, elapsedMs: Schema.Finite }),
  ),
);

const decodeExitLine = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ type: Schema.String, elapsedMs: Schema.Finite })),
);

const stopsPromptly = Effect.fn(function* (command: string, name: string, how: StopMode) {
  const fixture = fileURLToPath(new URL("./fixtures/worker-process-exit.ts", import.meta.url));
  const lines = yield* runFixture(command, [fixture, how], name === "Node");
  const [resultLine, exitLine] = lines;
  if (resultLine === undefined) throw new Error("Expected a result line");
  const result = yield* decodeResultLine(resultLine);
  expect(result).toMatchObject({
    type: "result",
    kind: how === "timeout" ? "timeout" : "aborted",
  });
  expect(result.elapsedMs).toBeLessThan(1000);
  if (name === "Node") {
    expect(lines).toHaveLength(2);
    if (exitLine === undefined) throw new Error("Expected an exit line");
    const exit = yield* decodeExitLine(exitLine);
    expect(exit.type).toBe("exit");
    expect(exit.elapsedMs - result.elapsedMs).toBeLessThan(1000);
  }
});

describe.each(runtimes)("$name process lifetime", ({ name, command, available }) => {
  it.skipIf(!available).each(["abort", "timeout", "close"] as const)(
    name === "Node"
      ? "exits promptly after %s with a real worker"
      : "settles %s promptly with a real worker",
    (how) => Effect.runPromise(stopsPromptly(command, name, how)),
    25000,
  );
});
