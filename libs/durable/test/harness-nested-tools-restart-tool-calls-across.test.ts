import {
  type Harness,
  LiveDoc,
  type NestedToolExecutionResult,
  type ToolTaskInput,
} from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  DONE,
  call,
  tool,
  directories,
  sqlitePath,
  codes,
  nestedTasks,
  restartDuring,
  open,
} from "./harness-nested-tools-restart-support.ts";
import { chatSetup, awaited, addTool, removeDir, context, aborted, deferred } from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function slotsAtCallerEnd(harness: Harness) {
  const seen: { slots?: number } = {};
  harness.subscribeCommits((publication) => {
    for (const change of publication.changes) {
      if (change.type !== "task" || change.value.kind !== ToolTask.definition.name) continue;
      if (
        (change.value.input as ToolTaskInput).kind !== "model" ||
        change.value.state.status !== "terminal"
      )
        continue;
      const live = publication.changes.find(
        (each) => each.type === "document" && each.record.kind === "msa.live",
      );
      const value =
        live?.type === "document" ? (live.value as { nestedTools?: unknown[] } | null) : undefined;
      seen.slots = value?.nestedTools?.length ?? 0;
    }
  });
  return seen;
}

const replaySafeBatch = Effect.fn("replaySafeBatch")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const runs = { safe: 0, unsafe: 0, caller: 0 };
  const running = { safe: deferred(), unsafe: deferred() };
  addTool(
    setup.registry,
    tool(
      "safe",
      (_args, _api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            runs.safe++;
            if (runs.safe === 1) {
              running.safe.resolve();
              return yield* awaited(aborted(callContext.abortSignal!));
            }
            return { output: [{ type: "text", text: `safe run ${runs.safe}` }] };
          }),
        ),
      { replay: "safe" },
    ),
  );
  addTool(
    setup.registry,
    tool("unsafe", (_args, _api, callContext) => {
      runs.unsafe++;
      running.unsafe.resolve();
      return Promise.resolve(aborted(callContext.abortSignal!));
    }),
  );
  return { path, setup, runs, running };
});

const marksNothingReopened = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const running = deferred();
  addTool(
    setup.registry,
    tool("hang", (_args, _api, callContext) => {
      running.resolve();
      return Promise.resolve(aborted(callContext.abortSignal!));
    }),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("hang", {}, callContext));
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  let opened = yield* open(path, setup);
  yield* awaited(opened.root.submit({ type: "input", content: "go" }, context));
  yield* awaited(running.promise);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  const inspected = yield* awaited(opened.harness.inspect(context));
  expect(inspected.scheduling).toBe("paused");
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  const [nested] = yield* nestedTasks(opened.harness);
  expect(nested).toMatchObject({ abandonOnRestart: true, abortRequested: false });
  expect(nested!.state.status).toBe("pending");
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("marks nothing when the reopened Harness never starts scheduling", () =>
    Effect.runPromise(marksNothingReopened));
});

const letsReplaySafe = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { path, setup, runs, running } = yield* replaySafeBatch();
  let toolResults: NestedToolExecutionResult[] = [];
  addTool(
    setup.registry,
    tool(
      "batch",
      (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            runs.caller++;
            toolResults = yield* awaited(
              Promise.all([
                api.executeTool("safe", {}, callContext),
                api.executeTool("unsafe", {}, callContext),
              ]),
            );
            return {};
          }),
        ),
      { replay: "safe" },
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  const { opened, id } = yield* restartDuring(
    path,
    setup,
    Promise.all([running.safe.promise, running.unsafe.promise]),
  );
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(runs).toEqual({ safe: 2, unsafe: 1, caller: 2 });
  expect(yield* nestedTasks(opened.harness)).toHaveLength(2);
  for (const task of yield* nestedTasks(opened.harness)) {
    expect(task.abandonOnRestart).toBeUndefined();
    expect(task.abortReason).toBeUndefined();
  }
  expect(toolResults[0]?.structuredOutput).toBe("safe run 2");
  expect(codes(toolResults[1])).toEqual(["interrupted"]);
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("lets a replay-safe caller's unfinished nested calls recover and reattaches to them by key", () =>
    Effect.runPromise(letsReplaySafe));
});

const clearsSlotsNested = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const finished = deferred();
  let attempts = 0;
  addTool(
    setup.registry,
    tool("quick", () => Promise.resolve({ output: [{ type: "text", text: "ok" }] })),
  );
  addTool(
    setup.registry,
    tool(
      "caller",
      (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            attempts++;
            if (attempts === 1) {
              yield* awaited(api.executeTool("quick", {}, callContext));
              finished.resolve();
              return yield* awaited(aborted(callContext.abortSignal!));
            }
            return { output: [{ type: "text", text: "done" }] };
          }),
        ),
      { replay: "safe" },
    ),
  );
  setup.faux.setResponses([call("caller"), DONE]);
  let opened = yield* open(path, setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(finished.promise);
  expect(
    (yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context)))?.nestedTools,
  ).toHaveLength(1);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  const afterCaller = slotsAtCallerEnd(opened.harness);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(attempts).toBe(2);
  expect(afterCaller.slots).toBe(0);
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("clears the slots of nested calls an earlier attempt finished when the rerun makes none", () =>
    Effect.runPromise(clearsSlotsNested));
});

const abortsNestedCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const running = deferred();
  let attempts = 0;
  addTool(
    setup.registry,
    tool(
      "slow",
      (_args, _api, callContext) => {
        running.resolve();
        return Promise.resolve(aborted(callContext.abortSignal!));
      },
      { replay: "safe" },
    ),
  );
  addTool(
    setup.registry,
    tool(
      "caller",
      (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            attempts++;
            if (attempts === 1)
              yield* awaited(api.executeTool("slow", {}, callContext, { key: "slow" }));
            return { output: [{ type: "text", text: "done" }] };
          }),
        ),
      { replay: "safe" },
    ),
  );
  setup.faux.setResponses([call("caller"), DONE]);
  const { opened, id } = yield* restartDuring(path, setup, running.promise);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(attempts).toBe(2);
  const [leftover] = yield* nestedTasks(opened.harness);
  expect(leftover?.state).toMatchObject({
    status: "terminal",
    outcome: { status: "aborted" },
  });
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("aborts a nested call an earlier attempt of a replay-safe caller left running and the rerun never made again", () =>
    Effect.runPromise(abortsNestedCall));
});
