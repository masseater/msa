import { LiveDoc, type NestedToolExecutionResult } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import harnessNestedToolsSupport from "./harness-nested-tools-support.ts";
import support from "./support.ts";

const { DONE, call, directories, echoTool, results, runOnce, text, tool, toolTasks } =
  harnessNestedToolsSupport;
const {
  aborted,
  addTool,
  allEntries,
  awaited,
  chatSetup,
  context,
  deferred,
  makeTempFile,
  openChat,
  removeDir,
} = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const interruptedCleanupBatch = Effect.fn("interruptedCleanupBatch")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { directory, path } = yield* makeTempFile("msa-durable-nested-", "session.sqlite");
  directories.add(directory);
  const setup = chatSetup();
  const running = deferred();
  const cleaning = deferred();
  const release = deferred();
  const counts: { hangRuns: number } = { hangRuns: 0 };
  addTool(
    setup.registry,
    tool("hang", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          counts.hangRuns++;
          api.output("partial\n");
          yield* awaited(api.details({ step: 1 }, callContext));
          running.resolve();
          yield* awaited(aborted(callContext.abortSignal!).catch(() => {}));
          cleaning.resolve();
          yield* awaited(release.promise);
          throw new Error("aborted");
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          void api.executeTool("hang", {}, callContext).catch(() => {});
          yield* awaited(running.promise);
          return { output: [{ text: "returned early", type: "text" }] };
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { cleaning, counts, path, release, setup };
});

const admitsOneNested = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  let both: NestedToolExecutionResult[] = [];
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          both = yield* awaited(
            Promise.all([
              api.executeTool("echo", { text: "a" }, callContext, { key: "k" }),
              api.executeTool("echo", { text: "a" }, callContext, { key: "k" }),
            ]),
          );
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(echo.state.runs).toBe(1);
  expect(both.map((result) => text(result))).toEqual(["echo a", "echo a"]);
  expect(yield* toolTasks(harness)).toHaveLength(2);
  yield* awaited(harness.close(context));
});

const abortsLeftRunning = Effect.gen(function* () {
  const { path, setup, cleaning, release, counts } = yield* interruptedCleanupBatch();
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const id = (yield* awaited(opened.root.submit({ content: "go", type: "input" }, context))).id;
  yield* awaited(cleaning.promise);
  const closed = opened.harness.close(context);
  release.resolve();
  yield* awaited(closed);

  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  yield* awaited(opened.harness.waitForIdle(context));
  const [result] = results(yield* allEntries(opened.root));
  expect(result).toMatchObject({ isError: true, toolCallId: "c1" });
  expect(text(result)).toContain("Tool batch was interrupted");
  const [, child] = yield* toolTasks(opened.harness);
  expect(child!.state).toMatchObject({ outcome: { status: "aborted" }, status: "terminal" });
  expect(counts.hangRuns).toBe(1);
  expect(yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context))).toEqual({});
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls", () => {
  it("admits one nested call for a key used by concurrent calls", () =>
    Effect.runPromise(admitsOneNested));

  it("aborts left-running nested calls of a caller interrupted while it cleaned them up", () =>
    Effect.runPromise(abortsLeftRunning));
});
