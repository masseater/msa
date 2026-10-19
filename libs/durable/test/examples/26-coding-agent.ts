import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  type ToolResultMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@msa/ai";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { defineExtension, type HarnessSettings, section, ToolResultEntry } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { CodingTools } from "../../src/tools/index.ts";
import { awaited, joinPath, makeDirectory, makeTempDir, removeDir } from "../support.ts";

const context = BACKGROUND_CONTEXT;

const mainStep1 = Effect.gen(function* () {
  const workspace = yield* makeTempDir("msa-durable-agent-");
  yield* makeDirectory(joinPath(workspace, "app"));

  const Coding = defineExtension({
    name: "coding",
    sections: [
      section("preamble", () => "You are a coding agent. Use the tools to inspect the project.", {
        tag: false,
      }),
      section("cwd", (input) => input.env?.cwd),
    ],
  });
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(Coding);

  const userSettings = { parallelTools: true, maxRetries: 3 };
  const settings: HarnessSettings = {
    get toolExecution() {
      return userSettings.parallelTools ? "parallel" : "sequential";
    },
    get retry() {
      return { maxRetries: userSettings.maxRetries };
    },
  };

  const env = ({ cwd = workspace }: { readonly cwd?: string }) => new NodeExecutionEnv({ cwd });

  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const pwd = () =>
    fauxAssistantMessage(fauxToolCall("bash", { command: "pwd" }), { stopReason: "toolUse" });
  faux.setResponses([pwd(), fauxAssistantMessage("Done."), pwd(), fauxAssistantMessage("Done.")]);

  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { models, registry, settings, env }, context),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" }, cwd: workspace },
    }),
  );
  return { workspace, userSettings, harness, root };
});

const main = Effect.gen(function* () {
  const { workspace, userSettings, harness, root } = yield* mainStep1;
  const lastBashOutput = Effect.fn("lastBashOutput")(function* () {
    const page = yield* awaited(root.entries({}, 10, undefined, context));
    const result = page.items.find((entry) => ToolResultEntry.is(entry))
      ?.model?.[0] as ToolResultMessage;
    return result.content.map((part) => (part.type === "text" ? part.text.trim() : "")).join("");
  });

  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "Where are we?" }, context))).wait(
      context,
    ),
  );
  yield* Console.log("bash ran in:", yield* lastBashOutput());

  yield* awaited(root.configure({ cwd: joinPath(workspace, "app") }, context));
  userSettings.parallelTools = false;
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "And now?" }, context))).wait(context),
  );
  yield* Console.log("bash ran in:", yield* lastBashOutput());

  yield* awaited(harness.close(context));
  yield* removeDir(workspace);
});

NodeRuntime.runMain(main);
