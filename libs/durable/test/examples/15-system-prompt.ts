import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import type durableTypes from "../../src/index.types.ts";
import durableKit from "../durable-kit.ts";
import effectSupport from "../effect-support.ts";

const { durable, envNode: node, harness: harnessModule, memory } = durableKit;

const { SystemEntry, defineExtension, section, wrapSection } = durable;
const { Harness, createRegistry } = harnessModule;
const { NodeExecutionEnv } = node;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;

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

const mainStep1 = Effect.gen(function* () {
  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { env, models, registry }, context),
  );
  const model = { modelId: "faux-1", provider: "faux" };
  const root = yield* awaited(harness.root(context, { agent: { cwd: "/repo", model } }));

  const subagent = yield* awaited(
    harness.createConversation(
      {
        agent: {
          cwd: "/repo",
          extensions: { remove: [AgentsMd] },
          instructions: "Only read; never edit files.",
          model,
        },
        ownership: { kind: "ownerless" },
      },
      context,
    ),
  );

  const systemEntries = Effect.fn("systemEntries")(function* (
    conversation: durableTypes.Conversation,
  ) {
    const page = yield* awaited(conversation.entries({}, 20, undefined, context));
    return [...page.items]
      .reverse()
      .flatMap((entry) => (SystemEntry.is(entry) ? (entry.model ?? []) : []));
  });

  yield* awaited(
    (yield* awaited(root.submit({ content: "Fix the build.", type: "input" }, context))).wait(
      context,
    ),
  );
  yield* awaited(
    (yield* awaited(subagent.submit({ content: "Read the logs.", type: "input" }, context))).wait(
      context,
    ),
  );
  yield* Console.log("root system prompt:", yield* systemEntries(root));
  yield* Console.log("subagent system prompt:", yield* systemEntries(subagent));

  yield* awaited(root.configure({ cwd: "/repo/packages" }, context));
  return { harness, root, systemEntries };
});

const main = Effect.gen(function* () {
  const { harness, root, systemEntries } = yield* mainStep1;
  yield* awaited(
    (yield* awaited(root.submit({ content: "Now the package.", type: "input" }, context))).wait(
      context,
    ),
  );
  yield* Console.log("root system entries after cwd change:", yield* systemEntries(root));

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
