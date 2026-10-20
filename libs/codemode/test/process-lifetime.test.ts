import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import processRunner from "./process-runner.ts";

const { allLines, firstLine, isAvailable } = processRunner;

type StopMode = "abort" | "timeout" | "close";

const runtimes = [
  { command: process.execPath, name: "Node", probe: Effect.succeed(true) },
  { command: "bun", name: "Bun", probe: Effect.promise(() => isAvailable("bun")) },
];

const runFixture = (command: string, args: string[], untilExit: boolean) =>
  Effect.promise(() => (untilExit ? allLines(command, args) : firstLine(command, args)));

const decodeResultLine = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ elapsedMs: Schema.Finite, kind: Schema.String, type: Schema.String }),
  ),
);

const decodeExitLine = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ elapsedMs: Schema.Finite, type: Schema.String })),
);

const stopsPromptly = Effect.fn(function* (command: string, name: string, how: StopMode) {
  const fixture = fileURLToPath(new URL("./fixtures/worker-process-exit.ts", import.meta.url));
  const lines = yield* runFixture(command, [fixture, how], name === "Node");
  const [resultLine, exitLine] = lines;
  if (resultLine === undefined) throw new Error("Expected a result line");
  const result = yield* decodeResultLine(resultLine);
  expect(result).toMatchObject({
    kind: how === "timeout" ? "timeout" : "aborted",
    type: "result",
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

describe.each(runtimes)("$name process lifetime", ({ name, command, probe }) => {
  const availability = { value: false };
  beforeAll(() =>
    Effect.runPromise(
      Effect.map(probe, (value) => {
        availability.value = value;
      }),
    ),
  );
  it.for(["abort", "timeout", "close"] as const)(
    name === "Node"
      ? "exits promptly after %s with a real worker"
      : "settles %s promptly with a real worker",
    { timeout: 25000 },
    (how, { skip }) => {
      if (!availability.value) skip();
      return Effect.runPromise(stopsPromptly(command, name, how));
    },
  );
});
