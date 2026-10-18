import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import type { ToolResultMessage } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { createRegistry, Harness } from "../../src/harness/index.ts";
import {
  defineExtension,
  type HarnessSettings,
  section,
  ToolResultEntry,
} from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { CodingTools } from "../../src/tools/index.ts";
import { awaited } from "../effect-support.ts";
import { joinPath } from "../platform-support.ts";

const context = BACKGROUND_CONTEXT;

const main = Effect.gen(function* () {
  const workspace = yield* awaited(mkdtemp(joinPath(tmpdir(), "msa-durable-agent-")));
  yield* awaited(mkdir(joinPath(workspace, "app")));

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
  yield* awaited(rm(workspace, { recursive: true, force: true }));
});

NodeRuntime.runMain(main);
