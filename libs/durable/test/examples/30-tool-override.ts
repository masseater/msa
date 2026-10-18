import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import type { ToolResultMessage } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { currentTimeMillis } from "../../src/clock.ts";
import { NodeExecutionEnv } from "../../src/env/node.ts";
import { createRegistry, Harness } from "../../src/harness/index.ts";
import { type Conversation, defineExtension, ToolResultEntry, wrapTool } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { CodingTools, createBashTool } from "../../src/tools/index.ts";
import { awaited } from "../effect-support.ts";
import { joinPath, makeDirectory, makeTempDir, removeDir, writeText } from "../platform-support.ts";

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

const main = Effect.gen(function* () {
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
        models,
        registry,
        settings: { extensions: [CodingTools, Timing] },
        env: () => new NodeExecutionEnv({ cwd: project }),
      },
      context,
    ),
  );
  const model = { provider: "faux", modelId: "faux-1" };
  const plain = yield* awaited(harness.root(context, { agent: { model } }));
  const python = yield* awaited(
    harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model, extensions: { add: [Venv] } } },
      context,
    ),
  );

  const probeBash = Effect.fn("probeBash")(function* (conversation: Conversation) {
    yield* awaited(
      (yield* awaited(
        conversation.submit({ type: "input", content: "Which venv?" }, context),
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
