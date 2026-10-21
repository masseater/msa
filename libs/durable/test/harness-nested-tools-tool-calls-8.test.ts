import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessNestedToolsSupport from "./harness-nested-tools-support.ts";
import support from "./support.ts";

const { LiveDoc } = durable;
const { MemoryStorage } = memory;

const { DONE, call, directories, echoTool, runOnce, tool } = harnessNestedToolsSupport;
const { addTool, awaited, chatSetup, context, deferred, openChat, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const runsNestedCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const seen: unknown[] = [];
  addTool(
    setup.registry,
    tool(
      "repaired",
      (args) => {
        seen.push(args);
        return Promise.resolve({});
      },
      {
        prepareArguments: () => {
          const repaired: { text?: string | undefined } = { text: undefined };
          return repaired as { text?: string };
        },
      },
    ),
  );
  let result: durableTypes.NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          result = yield* awaited(api.executeTool("repaired", { text: "x" }, callContext));
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(result).toMatchObject({ isError: false });
  expect(seen).toEqual([{}]);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("runs a nested call whose repaired arguments set an optional property to undefined", () =>
    Effect.runPromise(runsNestedCall));
});

const findsEachNestedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(setup.registry, echoTool().registration);
  addTool(
    setup.registry,
    tool("inner", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("echo", { text: "m1" }, callContext));
          yield* awaited(api.executeTool("echo", { text: "m2" }, callContext));
          return {};
        }),
      ),
    ),
  );
  const before = deferred();
  const checked = deferred();
  return { before, checked, runPromise, setup };
});

const findsEachNested = Effect.gen(function* () {
  const { runPromise, setup, before, checked } = yield* findsEachNestedStep1;
  let slots: { callId: string; status: string; summary?: unknown }[] = [];
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("echo", { text: "n1" }, callContext));
          yield* awaited(api.executeTool("inner", {}, callContext));
          yield* awaited(api.executeTool("echo", { text: "n3" }, callContext));
          yield* awaited(api.executeTool("echo", { text: "n4" }, callContext));
          const live = yield* awaited(api.snapshot(LiveDoc, api.conversationId, callContext));
          slots = (live?.nestedTools ?? []).map(({ callId, status, summary }) => ({
            callId,
            status,
            summary,
          }));
          before.resolve();
          yield* awaited(checked.promise);
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(before.promise);
  const done = {
    status: "done",
    summary: { durationMs: expect.any(Number), isError: false },
  };
  expect(slots).toEqual(
    ["c1/1", "c1/2", "c1/3", "c1/4"].map((callId) => Object.assign({ callId }, done)),
  );
  checked.resolve();
  yield* awaited(submission.wait(context));
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("finds each nested call's slot after slots in the middle were removed", () =>
    Effect.runPromise(findsEachNested));
});
