import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  type AssistantMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@msa/ai";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { AssistantEntry, defineExtension, hook, section } from "@msa/durable";
import { createRegistry, GenerationTask, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { CodingTools, createReadTool } from "../../src/tools/index.ts";
import { awaited, joinPath, makeTempDir, removeDir, writeText } from "../support.ts";

const context = BACKGROUND_CONTEXT;
const textOf = (message: AssistantMessage) =>
  message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

const DONE = "No further findings.";
const Reviewer = defineExtension({
  name: "reviewer",
  sections: [
    section("role", () => `You review diffs. Report problems as a list. Never edit files.`),
  ],
  hooks: [
    hook(GenerationTask, {
      onYield: (answer) =>
        textOf(answer).includes(DONE)
          ? undefined
          : {
              continue: `Look again for anything you missed. Say "${DONE}" when there is nothing left.`,
            },
    }),
  ],
});

const main = Effect.gen(function* () {
  const worktree = yield* makeTempDir("msa-durable-review-");
  yield* writeText(joinPath(worktree, "user.ts"), "export const name = (user) => user.name;\n");

  const faux = fauxProvider({ models: [{ id: "big" }, { id: "small" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "user.ts" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("1. `name` does not handle a missing user."),
    fauxAssistantMessage(`2. \`user\` has no type. ${DONE}`),
  ]);

  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(Reviewer);
  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      {
        models,
        registry,
        settings: { extensions: [CodingTools] },
        env: ({ cwd = process.cwd() }) => new NodeExecutionEnv({ cwd }),
      },
      context,
    ),
  );
  yield* awaited(harness.root(context, { agent: { model: { provider: "faux", modelId: "big" } } }));

  const reviewer = yield* awaited(
    harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: { provider: "faux", modelId: "small" },
          extensions: [CodingTools, Reviewer],
          tools: [createReadTool()],
          cwd: worktree,
        },
      },
      context,
    ),
  );
  const agent = yield* awaited(reviewer.agent(context));
  yield* Console.log(
    "reviewer:",
    agent.model?.modelId,
    agent.extensions.map((extension) => extension.name),
    agent.tools.map((tool) => tool.name),
    agent.cwd === worktree,
  );

  yield* awaited(
    (yield* awaited(reviewer.submit({ type: "input", content: "Review user.ts." }, context))).wait(
      context,
    ),
  );
  const page = yield* awaited(reviewer.entries({}, 20, undefined, context));
  for (const entry of [...page.items].reverse()) {
    const message = entry.model?.[0];
    if (message?.role === "user") yield* Console.log(">", message.content);
    if (AssistantEntry.is(entry) && textOf(message as AssistantMessage) !== "") {
      yield* Console.log("reviewer:", textOf(message as AssistantMessage));
    }
  }

  yield* awaited(harness.close(context));
  yield* removeDir(worktree);
});

NodeRuntime.runMain(main);
