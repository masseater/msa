import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { type BashOperations, createBashTool } from "../../../src/core/tools/bash.ts";

function getTextOutput(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (
    result.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}

const ignoresOutputCallbacksAfterBashOperations = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let late: (() => void) | undefined;
  const operations: BashOperations = {
    exec: (_command, _cwd, { onData }) =>
      runPromise(
        Effect.sync(() => {
          onData(Buffer.from("before\n", "utf-8"));
          late = () => onData(Buffer.from("late\n", "utf-8"));
          return { exitCode: 0 };
        }),
      ),
  };
  const bash = createBashTool(process.cwd(), { operations });

  const result = yield* Effect.promise(() =>
    bash.execute("test-call-late-output", { command: "late-output" }),
  );
  late?.();
  yield* Effect.sleep(20);

  expect(getTextOutput(result).trim()).toBe("before");
});

const ignoresOutputCallbacksAfterBashOperationsResolve = () =>
  Effect.runPromise(ignoresOutputCallbacksAfterBashOperations);

describe("regression #5208: late bash output callbacks", () => {
  it(
    "ignores output callbacks after bash operations resolve",
    ignoresOutputCallbacksAfterBashOperationsResolve,
  );
});
