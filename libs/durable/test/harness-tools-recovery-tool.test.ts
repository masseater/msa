import type { JsonValue } from "@msa/chord";
import { LiveDoc } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import {
  DONE,
  call,
  text,
  results,
  open,
  tool,
  sqlitePath,
  removeDirectories,
} from "./harness-tools-recovery-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(removeDirectories);

const letsContextDerivation = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("bad", () =>
      Promise.resolve({ output: [], details: { fn: (() => 1) as unknown as JsonValue } }),
    ),
  );
  const requests: string[] = [];
  setup.faux.setResponses([
    call("bad"),
    (request) => {
      const result = request.messages.find((message) => message.role === "toolResult");
      requests.push(result?.role === "toolResult" ? text(result) : "none");
      return DONE;
    },
  ]);
  const opened = yield* open(path, setup);
  const settled = yield* awaited(
    (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  expect(settled.status).toBe("done");
  expect(results(yield* allEntries(opened.root))).toEqual([]);
  expect(requests).toEqual(["Tool result unavailable: history ends before this call completed."]);
  const tasks = yield* awaited(
    opened.harness.commit((tx) => tx.scanTasks({ conversationId: opened.root.id }, 20), context),
  );
  const faulted = tasks.items.find((task) => task.kind === "msa.tool")!;
  expect(faulted.state).toMatchObject({ status: "terminal", outcome: { status: "faulted" } });
  yield* awaited(opened.harness.close(context));
});

describe("tool recovery", () => {
  it("lets context derivation answer a faulted tool and continues the run", () =>
    Effect.runPromise(letsContextDerivation));
});

const clearsInterruptedAttempt = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const started = [deferred(), deferred()];
  let runs = 0;
  addTool(
    setup.registry,
    tool(
      "work",
      (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            const run = runs++;
            if (run === 0) {
              api.diagnostic({ severity: "info", message: "first a" });
              api.diagnostic({ severity: "info", message: "first b" });
              yield* awaited(api.details({ run: 1, extra: true }, callContext));
            } else {
              api.diagnostic({ severity: "info", message: "second" });
              yield* awaited(api.details({ run: 2 }, callContext));
            }
            started[run]!.resolve();
            return yield* awaited(aborted(callContext.abortSignal!));
          }),
        ),
      { replay: "safe" },
    ),
  );
  setup.faux.setResponses([call("work"), DONE]);
  let opened = yield* open(path, setup);
  yield* awaited(opened.root.submit({ type: "input", content: "go" }, context));
  yield* awaited(started[0]!.promise);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  yield* awaited(started[1]!.promise);
  const slot = (yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context)))
    ?.tools?.[0];
  expect(slot?.diagnostics).toEqual([{ severity: "info", message: "second" }]);
  expect(slot?.details).toEqual({ run: 2 });
  yield* awaited(opened.harness.close(context));
});

describe("tool recovery", () => {
  it("clears the interrupted attempt's progress before a safe rerun", () =>
    Effect.runPromise(clearsInterruptedAttempt));
});
