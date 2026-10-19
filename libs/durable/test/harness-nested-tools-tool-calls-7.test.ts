import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { directories, DONE, call, tool } from "./harness-nested-tools-support.ts";
import {
  chatSetup,
  openChat,
  awaited,
  addTool,
  removeDir,
  context,
  deferred,
  eventually,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function twoWritingNestedCalls() {
  const setup = chatSetup();
  const release = deferred();
  const running = { one: deferred(), two: deferred() };
  const wrote = { one: deferred(), two: deferred() };
  addTool(
    setup.registry,
    tool("slow", (args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const name = args.text as "one" | "two";
          running[name].resolve();
          yield* awaited(wrote[name].promise);
          api.output(`${name}\n`);
          yield* awaited(api.details({ name }, callContext));
          yield* awaited(release.promise);
          return {};
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* awaited(
            Promise.all([
              api.executeTool("slow", { text: "one" }, callContext),
              api.executeTool("slow", { text: "two" }, callContext),
            ]),
          );
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { setup, release, running, wrote };
}

const reportsOutputSeveral = Effect.gen(function* () {
  const { setup, release, running, wrote } = twoWritingNestedCalls();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* awaited(Promise.all([running.one.promise, running.two.promise]));
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  expect(stream.snapshot.nestedTools.map((slot) => [slot.callId, slot.status])).toEqual([
    ["c1/1", "running"],
    ["c1/2", "running"],
  ]);
  const updates: [string, unknown][] = [];
  stream.start((batch) => {
    for (const event of batch) {
      if (event.type === "tool_execution_update" && event.output !== undefined) {
        updates.push([event.toolCallId, event.output]);
      }
    }

    return Promise.resolve();
  });
  wrote.two.resolve();
  yield* eventually(() => updates.length === 1);
  wrote.one.resolve();
  yield* eventually(() => updates.length === 2);
  release.resolve();
  yield* awaited(submission.wait(context));
  yield* awaited(stream.stop());
  expect(updates).toEqual([
    ["c1/2", { set: "two\n" }],
    ["c1/1", { set: "one\n" }],
  ]);
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("reports the output of several running nested calls, and shows them to a late subscriber", () =>
    Effect.runPromise(reportsOutputSeveral));
});
