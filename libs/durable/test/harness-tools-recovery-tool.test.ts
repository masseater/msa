import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import harnessToolsRecoverySupport from "./harness-tools-recovery-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { LiveDoc } = durable;

const { allEntries, chatSetup } = chatSupport;
const { awaited } = effectSupport;
const { addTool } = harnessSupport;
const { DONE, call, open, removeDirectories, results, sqlitePath, text, tool } =
  harnessToolsRecoverySupport;
const { context } = sessionSupport;
const { aborted, deferred } = taskSupport;

afterEach(removeDirectories);

const letsContextDerivation = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("bad", () =>
      Promise.resolve({
        details: { fn: (() => 1) as unknown as chordTypes.JsonValue },
        output: [],
      }),
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
    (yield* awaited(opened.root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(settled.status).toBe("done");
  expect(results(yield* allEntries(opened.root))).toEqual([]);
  expect(requests).toEqual(["Tool result unavailable: history ends before this call completed."]);
  const tasks = yield* awaited(
    opened.harness.commit((tx) => tx.scanTasks({ conversationId: opened.root.id }, 20), context),
  );
  const faulted = tasks.items.find((task) => task.kind === "msa.tool")!;
  expect(faulted.state).toMatchObject({ outcome: { status: "faulted" }, status: "terminal" });
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
              api.diagnostic({ message: "first a", severity: "info" });
              api.diagnostic({ message: "first b", severity: "info" });
              yield* awaited(api.details({ extra: true, run: 1 }, callContext));
            } else {
              api.diagnostic({ message: "second", severity: "info" });
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
  yield* awaited(opened.root.submit({ content: "go", type: "input" }, context));
  yield* awaited(started[0]!.promise);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  yield* awaited(started[1]!.promise);
  const slot = (yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context)))
    ?.tools?.[0];
  expect(slot?.diagnostics).toEqual([{ message: "second", severity: "info" }]);
  expect(slot?.details).toEqual({ run: 2 });
  yield* awaited(opened.harness.close(context));
});

describe("tool recovery", () => {
  it("clears the interrupted attempt's progress before a safe rerun", () =>
    Effect.runPromise(clearsInterruptedAttempt));
});
