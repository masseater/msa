import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { createRegistry, Harness } from "../../src/harness/index.ts";
import {
  type Conversation,
  defineExtension,
  SystemEntry,
  section,
  wrapSection,
} from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

const context = BACKGROUND_CONTEXT;
const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([
  fauxAssistantMessage("Done."),
  fauxAssistantMessage("Done."),
  fauxAssistantMessage("Done."),
]);

const Coding = defineExtension({
  name: "coding",
  sections: [
    section("preamble", () => "You are a coding agent.", { tag: false }),
    section("cwd", (input) => input.env?.cwd),
  ],
});
const AgentsMd = defineExtension({
  name: "agents-md",
  sections: [section("agents_md", () => "Run npm run check after changes.")],
});
const Terse = defineExtension({
  name: "terse",
  wraps: [
    wrapSection("preamble", (preamble) => ({
      ...preamble,
      render: (input, renderContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            return `${yield* awaited(preamble.render(input, renderContext))} Be terse.`;
          }),
        ),
    })),
  ],
});

const registry = createRegistry();
registry.install(Coding);
registry.install(AgentsMd);
registry.install(Terse);
const env = ({ cwd = "/" }: { readonly cwd?: string }) => new NodeExecutionEnv({ cwd });

const main = Effect.gen(function* () {
  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { models, registry, env }, context),
  );
  const model = { provider: "faux", modelId: "faux-1" };
  const root = yield* awaited(harness.root(context, { agent: { model, cwd: "/repo" } }));

  const subagent = yield* awaited(
    harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model,
          cwd: "/repo",
          extensions: { remove: [AgentsMd] },
          instructions: "Only read; never edit files.",
        },
      },
      context,
    ),
  );

  const systemEntries = Effect.fn("systemEntries")(function* (conversation: Conversation) {
    const page = yield* awaited(conversation.entries({}, 20, undefined, context));
    return [...page.items]
      .reverse()
      .flatMap((entry) => (SystemEntry.is(entry) ? (entry.model ?? []) : []));
  });

  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "Fix the build." }, context))).wait(
      context,
    ),
  );
  yield* awaited(
    (yield* awaited(subagent.submit({ type: "input", content: "Read the logs." }, context))).wait(
      context,
    ),
  );
  yield* Console.log("root system prompt:", yield* systemEntries(root));
  yield* Console.log("subagent system prompt:", yield* systemEntries(subagent));

  yield* awaited(root.configure({ cwd: "/repo/packages" }, context));
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "Now the package." }, context))).wait(
      context,
    ),
  );
  yield* Console.log("root system entries after cwd change:", yield* systemEntries(root));

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
