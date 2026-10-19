import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { currentTimeMillis } from "../src/clock.ts";
import { CodemodeRunDoc } from "../src/codemode/codemode.ts";
import { codemodeChat } from "./codemode-chat-support.ts";
import { restart, removeDirectories } from "./codemode-support.ts";
import { awaited, context } from "./support.ts";

afterEach(removeDirectories);

const refusesResumeSandbox = Effect.gen(function* () {
  for (const field of ["fingerprint", "version"] as const) {
    const chat = codemodeChat();
    const { harness, result } = yield* restart(
      chat,
      `await tools.hold({}); await tools.echo({ text: "late" });`,
      (opened, task) =>
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            opened.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                    if (field === "fingerprint") run.start!.fingerprint = "another sandbox";
                    else run.start!.version = 0;
                  }),
                ),
              context,
            ),
          );
        }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("cannot resume");
    expect(chat.echo.size).toBe(0);
    yield* awaited(harness.close(context));
  }
});

const timesScriptOut = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `// @options: {"timeout_ms": 60000}
			await tools.hold({}); await tools.echo({ text: "late" });`,
    (opened, task) =>
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          opened.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                  expect(run.start!.deadline).toBeGreaterThan(currentTimeMillis());
                  run.start!.deadline = currentTimeMillis() - 1;
                }),
              ),
            context,
          ),
        );
      }),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("deadline passed");
  expect(chat.echo.size).toBe(0);
  expect(chat.vm.starts).toBe(1);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("refuses to resume when the sandbox's fingerprint or the code mode version changed", () =>
    Effect.runPromise(refusesResumeSandbox));

  it("times a script out across a restart, without admitting new calls", () =>
    Effect.runPromise(timesScriptOut));
});
