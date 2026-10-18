import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import { type ConversationId, defineTool } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { reuseFauxChild } from "./harness-ownership-children.ts";
import { directories, gates, runs, gated } from "./harness-ownership-support.ts";
import {
  chatSetup,
  openChat,
  awaited,
  addTool,
  makeTempFile,
  removeDir,
  context,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      gates.clear();
      runs.clear();
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const replaySafeSubagent = Effect.fn("replaySafeSubagent")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { directory, path } = yield* makeTempFile("msa-durable-safe-subagent-", "session.sqlite");
  directories.add(directory);
  const children: ConversationId[] = [];
  const setup = chatSetup();
  addTool(
    setup.registry,
    defineTool({
      name: "subagent",
      description: "Delegates",
      parameters: Type.Object({}),
      replay: "safe",
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            const child = yield* reuseFauxChild(api, callContext);
            children.push(child);
            const request = {
              type: "input",
              content: "child task",
              requestId: `subagent:${api.taskId}`,
            } as const;
            const submission = yield* awaited(
              (yield* awaited(api.conversation(child, callContext)))!.submit(request, callContext),
            );
            const settled = yield* awaited(submission.wait(callContext));
            return { output: [{ type: "text", text: settled.status }] };
          }),
        ),
    }),
  );
  const childRun = gated(fauxAssistantMessage([fauxText("never")]));
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("subagent", {}, { id: "c1" })], { stopReason: "toolUse" }),
    childRun.step,
  ]);
  return { path, children, setup, childRun };
});

const rerunsReplaySafe = Effect.gen(function* () {
  const { path, children, setup, childRun } = yield* replaySafeSubagent();
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const input = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(childRun.reached);
  yield* awaited(opened.harness.close(context));

  setup.faux.setResponses([
    fauxAssistantMessage([fauxText("child answer")]),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(input, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(children).toHaveLength(2);
  expect(children[1]).toBe(children[0]);
  const child = (yield* awaited(opened.harness.conversation(children[0]!, context)))!;
  const entries = (yield* awaited(child.entries({}, 100, undefined, context))).items;
  expect(entries.filter((entry) => entry.kind === "msa.user")).toHaveLength(1);
  const results = (yield* awaited(opened.root.context(context))).messages.filter(
    (message) => message.role === "toolResult",
  );
  expect(results.map((message) => message.isError)).toEqual([false]);
  yield* awaited(opened.harness.close(context));
});

describe("owned conversations from tools and supervisors", () => {
  it("reruns a replay-safe subagent tool after a restart with the same child and submission", () =>
    Effect.runPromise(rerunsReplaySafe));
});
