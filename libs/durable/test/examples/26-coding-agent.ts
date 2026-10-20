import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  type ToolResultMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@msa/ai";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { type HarnessSettings, ToolResultEntry, defineExtension, section } from "@msa/durable";
import { Harness, createRegistry } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { CodingTools } from "../../src/tools/index.ts";
import support from "../support.ts";

const { awaited, joinPath, makeDirectory, makeTempDir, removeDir } = support;

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

  const userSettings = { maxRetries: 3, parallelTools: true };
  const settings: HarnessSettings = {
    get retry() {
      return { maxRetries: userSettings.maxRetries };
    },
    get toolExecution() {
      return userSettings.parallelTools ? "parallel" : "sequential";
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
    Harness.open(new MemoryStorage(), { env, models, registry, settings }, context),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { cwd: workspace, model: { modelId: "faux-1", provider: "faux" } },
    }),
  );
  return { harness, root, userSettings, workspace };
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
    (yield* awaited(root.submit({ content: "Where are we?", type: "input" }, context))).wait(
      context,
    ),
  );
  yield* Console.log("bash ran in:", yield* lastBashOutput());

  yield* awaited(root.configure({ cwd: joinPath(workspace, "app") }, context));
  userSettings.parallelTools = false;
  yield* awaited(
    (yield* awaited(root.submit({ content: "And now?", type: "input" }, context))).wait(context),
  );
  yield* Console.log("bash ran in:", yield* lastBashOutput());

  yield* awaited(harness.close(context));
  yield* removeDir(workspace);
});

NodeRuntime.runMain(main);
