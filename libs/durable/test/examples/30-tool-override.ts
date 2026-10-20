import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  type ToolResultMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import node from "../../src/env/node.ts";
import toolsModule from "../../src/tools/index.ts";
import support from "../support.ts";

const { ToolResultEntry, defineExtension, wrapTool } = durable;
const { CodingTools, createBashTool } = toolsModule;
const { Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;
const { NodeExecutionEnv } = node;

const {
  BACKGROUND_CONTEXT,
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  makeTempDir,
  removeDir,
  writeText,
} = support;

const context = BACKGROUND_CONTEXT;

const Venv = defineExtension({
  name: "venv",
  tools: [createBashTool({ commandPrefix: "source .venv/bin/activate" })],
});

const timings: number[] = [];
const Timing = defineExtension({
  name: "timing",
  wraps: [
    wrapTool(createBashTool(), (bash) => ({
      ...bash,
      execute: (args, api, callContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const start = currentTimeMillis();
            return yield* Effect.suspend(() => awaited(bash.execute(args, api, callContext))).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  timings.push(currentTimeMillis() - start);
                }),
              ),
            );
          }),
        ),
    })),
  ],
});

const mainStep1 = Effect.gen(function* () {
  const project = yield* makeTempDir("msa-durable-venv-");
  yield* makeDirectory(joinPath(project, ".venv/bin"));
  yield* writeText(
    joinPath(project, ".venv/bin/activate"),
    `export VIRTUAL_ENV="${project}/.venv"\n`,
  );

  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const probe = () =>
    fauxAssistantMessage(fauxToolCall("bash", { command: "echo venv: $VIRTUAL_ENV" }), {
      stopReason: "toolUse",
    });
  faux.setResponses([
    probe(),
    fauxAssistantMessage("Done."),
    probe(),
    fauxAssistantMessage("Done."),
  ]);

  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(Timing);
  registry.install(Venv);
  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      {
        env: () => new NodeExecutionEnv({ cwd: project }),
        models,
        registry,
        settings: { extensions: [CodingTools, Timing] },
      },
      context,
    ),
  );
  const model = { modelId: "faux-1", provider: "faux" };
  const plain = yield* awaited(harness.root(context, { agent: { model } }));
  return { harness, model, plain, project };
});

const main = Effect.gen(function* () {
  const { project, harness, model, plain } = yield* mainStep1;
  const python = yield* awaited(
    harness.createConversation(
      { agent: { extensions: { add: [Venv] }, model }, ownership: { kind: "ownerless" } },
      context,
    ),
  );

  const probeBash = Effect.fn("probeBash")(function* (conversation: durableTypes.Conversation) {
    yield* awaited(
      (yield* awaited(
        conversation.submit({ content: "Which venv?", type: "input" }, context),
      )).wait(context),
    );
    const page = yield* awaited(conversation.entries({}, 10, undefined, context));
    const result = page.items.find((entry) => ToolResultEntry.is(entry))
      ?.model?.[0] as ToolResultMessage;
    return result.content.map((part) => (part.type === "text" ? part.text.trim() : "")).join("");
  });

  yield* Console.log("plain conversation:", yield* probeBash(plain));
  yield* Console.log(
    "python conversation:",
    (yield* probeBash(python)).replace(project, "<project>"),
  );
  yield* Console.log("timed bash calls:", timings.length);

  yield* awaited(harness.close(context));
  yield* removeDir(project);
});

NodeRuntime.runMain(main);
