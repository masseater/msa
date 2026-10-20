import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Agent } from "@msa/agent-core";
import { createModels } from "@msa/ai";
import { anthropicProvider } from "@msa/ai/providers/anthropic";
import { McpClient, StdioTransport } from "@msa/mcp";
import { Console, Effect } from "effect";

import toolsModule from "./tools.ts";

const { createCodemodeTool, createMcpTools, createNestedToolRunner } = toolsModule;

const usage = Effect.gen(function* () {
  yield* Console.error("Usage: main.ts <mcp server command> [args...]");
  return yield* Effect.sync(() => process.exit(1));
});

const run = (agent: Agent, client: McpClient) =>
  Effect.gen(function* () {
    const mcpTools = yield* Effect.promise(() => createMcpTools(client, "mcp"));
    agent.state.tools = [...mcpTools, createCodemodeTool(mcpTools, createNestedToolRunner(agent))];
    agent.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      } else if (event.type === "tool_execution_start") {
        process.stdout.write(`\n[${event.toolName}]\n`);
      }
    });
    yield* Effect.promise(() =>
      agent.prompt(
        "Use codemode to list what the MCP tools can do, then summarize it in two sentences.",
      ),
    );
    yield* Console.log();
  });

const main = Effect.gen(function* () {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "") return yield* usage;
  const models = createModels();
  models.setProvider(anthropicProvider());
  const model = models
    .getModels("anthropic-api")
    .find((candidate) => candidate.reasoning && candidate.input.includes("image"));
  if (model === undefined)
    return yield* Effect.die(new Error("No Anthropic reasoning model accepts images"));
  const client = new McpClient({ name: "msa-agent-example", version: "1.0.0" });
  yield* Effect.promise(() => client.connect(new StdioTransport({ args, command })));
  const agent = new Agent({
    initialState: { model, systemPrompt: "You are a helpful assistant." },
    streamFn: models.streamSimple.bind(models),
  });
  yield* run(agent, client).pipe(Effect.ensuring(Effect.promise(() => client.close())));
});

NodeRuntime.runMain(main);
