import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { type ToolResultMessage, Type } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { createRegistry, Harness } from "../../src/harness/index.ts";
import { defineExtension, defineTool, ToolResultEntry } from "../../src/index.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import { awaited, joinPath, makeTempDir, removeDir } from "../support.ts";

const context = BACKGROUND_CONTEXT;

let started = (): void => {};
let gate = Promise.resolve();
function loadVersioned(version: string) {
  return defineExtension({
    name: "versioned",
    tools: [
      defineTool({
        name: "version",
        description: "Report the tool's code version",
        parameters: Type.Object({}),
        execute: () =>
          Effect.runPromise(
            Effect.gen(function* () {
              started();
              yield* awaited(gate);
              return { output: [{ type: "text", text: version }] };
            }),
          ),
      }),
    ],
  });
}

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
const callVersion = () =>
  fauxAssistantMessage(fauxToolCall("version", {}), { stopReason: "toolUse" });
faux.setResponses([
  callVersion(),
  fauxAssistantMessage("Done."),
  callVersion(),
  fauxAssistantMessage("Done."),
]);

const main = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-durable-reload-");
  const open = Effect.fn("open")(function* (registry: ReturnType<typeof createRegistry>) {
    return yield* awaited(
      Harness.open(
        yield* awaited(openNodeSqliteStorage(joinPath(directory, "session.sqlite"))),
        { models, registry },
        context,
      ),
    );
  });

  let registry = createRegistry();
  registry.install(loadVersioned("v1"));
  let harness = yield* open(registry);
  let root = yield* awaited(
    harness.root(context, {
      agent: {
        model: { provider: "faux", modelId: "faux-1" },
        extensions: [loadVersioned("v1")],
      },
    }),
  );
  const lastResult = Effect.fn("lastResult")(function* () {
    const page = yield* awaited(root.entries({}, 10, undefined, context));
    const result = page.items.find((entry) => ToolResultEntry.is(entry))
      ?.model?.[0] as ToolResultMessage;
    return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  });

  const opened = Promise.withResolvers<void>();
  const release = (): void => opened.resolve();
  gate = opened.promise;
  const { promise: running, resolve: start } = Promise.withResolvers<void>();
  started = start;
  const submission = yield* awaited(
    root.submit({ type: "input", content: "Which version?" }, context),
  );
  yield* awaited(running);
  registry.install(loadVersioned("v2"));
  release();
  yield* awaited(submission.wait(context));
  yield* Console.log("call running during the reload:", yield* lastResult());
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "And now?" }, context))).wait(context),
  );
  yield* Console.log("next call:", yield* lastResult());
  yield* awaited(harness.close(context));

  registry = createRegistry();
  harness = yield* open(registry);
  root = yield* awaited(harness.root(context));
  const tools = Effect.fn("tools")(function* () {
    return (yield* awaited(root.agent(context))).tools.map((tool) => tool.name);
  });
  yield* Console.log("after restart, before install:", yield* tools());
  registry.install(loadVersioned("v3"));
  yield* Console.log("after install:", yield* tools());

  yield* awaited(harness.close(context));
  yield* removeDir(directory);
});

NodeRuntime.runMain(main);
