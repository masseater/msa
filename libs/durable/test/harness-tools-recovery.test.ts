import { LiveDoc } from "@msa/durable";
import { GenerationTask, ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addHooks, addTool, type Installed } from "./harness-support.ts";
import {
  DONE,
  call,
  text,
  results,
  toolTaskId,
  open,
  tool,
  blockingTool,
  directories,
  sqlitePath,
} from "./harness-tools-recovery-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function rerunningWorkChat(path: string) {
  const setup = chatSetup();
  const cwds: (string | undefined)[] = [];
  const started = deferred();
  const work = tool(
    "work",
    (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          cwds.push(api.env?.cwd);
          if (cwds.length === 1) {
            started.resolve();
            return yield* awaited(aborted(callContext.abortSignal!));
          }
          return {};
        }),
      ),
    { replay: "safe" },
  );
  addTool(setup.registry, work);
  setup.faux.setResponses([call("work"), DONE]);
  const env = ({ cwd = "/" }: { readonly cwd?: string }) => new NodeExecutionEnv({ cwd });
  const reopen = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup, { env });
        opened.harness.resume();
        return opened;
      }),
    );
  return { cwds, started, reopen };
}

const answersUnsafeTool = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const setup = chatSetup();
  const { registration, started, state } = blockingTool("work");
  addTool(setup.registry, registration);
  setup.faux.setResponses([call("work"), DONE]);
  let opened = yield* open(path, setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(started.promise);
  const taskId = yield* toolTaskId(opened.harness);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  expect((yield* awaited(opened.harness.getTask(taskId, context)))?.state).toMatchObject({
    checkpoint: { phase: "execute", arguments: {}, replay: "unsafe" },
  });
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(state.runs).toBe(1);
  const [result] = results(yield* allEntries(opened.root));
  expect(result).toMatchObject({ isError: true, details: { run: 1 } });
  expect(text(result)).toBe(
    "run 1\n|<harness>\n[error] Tool work was interrupted and may have partially run\n</harness>",
  );
  expect(yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context))).toEqual({});
  yield* awaited(opened.harness.close(context));
});

describe("tool recovery", () => {
  it("answers an unsafe tool interrupted after intent with its durable partial output", () =>
    Effect.runPromise(answersUnsafeTool));
});

const rerunsToolOnly = Effect.gen(function* () {
  const cases: [stored: "safe" | "unsafe", current: "safe" | "unsafe", reruns: boolean][] = [
    ["safe", "safe", true],
    ["safe", "unsafe", false],
    ["unsafe", "safe", false],
  ];
  for (const [stored, current, reruns] of cases) {
    const path = yield* sqlitePath();
    const setup = chatSetup();
    const blocking = blockingTool("work", { replay: stored });
    const registration: Installed = addTool(setup.registry, blocking.registration);
    setup.faux.setResponses([call("work"), DONE]);
    let opened = yield* open(path, setup);
    const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
    yield* awaited(blocking.started.promise);
    yield* awaited(opened.harness.close(context));

    registration.dispose();
    addTool(setup.registry, { ...blocking.registration, replay: current });
    opened = yield* open(path, setup);
    expect(
      (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
        .status,
    ).toBe("done");
    const [result] = results(yield* allEntries(opened.root));
    expect(blocking.state.runs).toBe(reruns ? 2 : 1);
    expect(result!.isError).toBe(!reruns);
    if (reruns) expect(text(result)).toBe("run 2\n");
    yield* awaited(opened.harness.close(context));
  }
});

describe("tool recovery", () => {
  it("reruns a tool only when both the stored and the current replay policy are safe", () =>
    Effect.runPromise(rerunsToolOnly));
});

const rerunsSafeTool = Effect.gen(function* () {
  for (const change of ["cwd", "deselect"] as const) {
    const path = yield* sqlitePath();
    const { cwds, started, reopen } = rerunningWorkChat(path);
    let opened = yield* awaited(reopen());
    yield* awaited(opened.root.configure({ cwd: "/one" }, context));
    const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
    yield* awaited(started.promise);
    yield* awaited(
      opened.root.configure(change === "cwd" ? { cwd: "/two" } : { extensions: [] }, context),
    );
    yield* awaited(opened.harness.close(context));

    opened = yield* awaited(reopen());
    expect(
      (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
        .status,
    ).toBe("done");
    const [result] = results(yield* allEntries(opened.root));
    if (change === "cwd") {
      expect(cwds).toEqual(["/one", "/two"]);
      expect(result!.isError).toBe(false);
    } else {
      expect(cwds).toEqual(["/one"]);
      expect(text(result)).toContain("was interrupted");
    }
    yield* awaited(opened.harness.close(context));
  }
});

describe("tool recovery", () => {
  it("reruns a safe tool with the environment of the conversation's cwd at rerun, and not once it is deselected", () =>
    Effect.runPromise(rerunsSafeTool));
});

const rerunsBeforeToolInterrupted = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  let runs = 0;
  addTool(
    setup.registry,
    tool("work", () => {
      runs++;
      return Promise.resolve({ output: [] });
    }),
  );
  const reached = deferred();
  let asked = 0;
  const decisions: string[] = [];
  addHooks(setup.registry, ToolTask, {
    beforeTool: (_call, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          asked++;
          decisions.push(
            yield* awaited(api.memo("test:decision", `attempt ${asked}`, callContext)),
          );
          if (asked === 1) {
            reached.resolve();
            return yield* awaited(aborted(callContext.abortSignal!));
          }
          return undefined;
        }),
      ),
  });
  setup.faux.setResponses([call("work"), DONE]);
  let opened = yield* open(path, setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(reached.promise);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect([asked, runs]).toEqual([2, 1]);
  expect(decisions).toEqual(["attempt 1", "attempt 1"]);
  yield* awaited(opened.harness.close(context));
});

describe("tool recovery", () => {
  it("reruns beforeTool when interrupted before intent, and executes once", () =>
    Effect.runPromise(rerunsBeforeToolInterrupted));
});

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
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
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
  const submission = yield* awaited(opened.root.submit({ type: "input", content: "go" }, context));
  yield* awaited(started.promise);
  const taskId = yield* toolTaskId(opened.harness);
  expect(yield* awaited(opened.harness.abortTask(taskId, context))).toBe("marked");
  expect((yield* awaited(opened.harness.waitForTask(taskId, context))).state.outcome).toMatchObject(
    {
      status: "aborted",
      result: { entryId: expect.any(Number) },
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
