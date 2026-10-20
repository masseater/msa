import harnessModule from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessToolsRecoverySupport from "./harness-tools-recovery-support.ts";
import support from "./support.ts";

const { GenerationTask } = harnessModule;

const { DONE, blockingTool, call, directories, open, results, sqlitePath, text, tool, toolTaskId } =
  harnessToolsRecoverySupport;
const { aborted, addHooks, addTool, allEntries, awaited, chatSetup, context, deferred, removeDir } =
  support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const rerunsGenerationTools = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("work", () => Promise.resolve({ output: [] })),
  );
  const reached = deferred();
  let observed = 0;
  addHooks(setup.registry, GenerationTask, {
    afterTools: (_assistant, _results, _api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          observed++;
          if (observed === 1) {
            reached.resolve();
            return yield* awaited(aborted(callContext.abortSignal!));
          }
        }),
      ),
  });
  setup.faux.setResponses([call("work"), DONE]);
  let opened = yield* open(path, setup);
  const id = (yield* awaited(opened.root.submit({ content: "go", type: "input" }, context))).id;
  yield* awaited(reached.promise);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(observed).toBe(2);
  expect((yield* allEntries(opened.root)).map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.system",
    "msa.assistant",
    "msa.tool-result",
    "msa.assistant",
  ]);
  yield* awaited(opened.harness.close(context));
});

describe("tool recovery", () => {
  it("reruns the generation tools phase interrupted before its commit", () =>
    Effect.runPromise(rerunsGenerationTools));
});

const answersAbortedTool = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const setup = chatSetup();
  const { registration, started } = blockingTool("work");
  addTool(setup.registry, registration);
  setup.faux.setResponses([call("work"), DONE]);
  const opened = yield* open(path, setup);
  const submission = yield* awaited(opened.root.submit({ content: "go", type: "input" }, context));
  yield* awaited(started.promise);
  const taskId = yield* toolTaskId(opened.harness);
  expect(yield* awaited(opened.harness.abortTask(taskId, context))).toBe("marked");
  expect((yield* awaited(opened.harness.waitForTask(taskId, context))).state.outcome).toMatchObject(
    {
      result: { entryId: expect.any(Number) },
      status: "aborted",
    },
  );
  expect((yield* awaited(submission.wait(context))).status).toBe("done");
  const [result] = results(yield* allEntries(opened.root));
  expect(text(result)).toBe("run 1\n|<harness>\n[error] Tool work was aborted\n</harness>");
  yield* awaited(opened.harness.close(context));
});

describe("tool recovery", () => {
  it("answers an aborted tool with its partial output and continues the run", () =>
    Effect.runPromise(answersAbortedTool));
});
