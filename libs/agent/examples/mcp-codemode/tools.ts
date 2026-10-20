import {
  type Agent,
  type AgentTool,
  type AgentToolCallOutcome,
  type AgentToolResult,
  runToolCall,
} from "@msa/agent-core";
import type { ImageContent, JsonObject, JsonValue, TextContent } from "@msa/ai";
import {
  type CodemodeJsonSchema,
  type CodemodeResult,
  CodemodeSandbox,
  type CodemodeTool,
  renderDeclarations,
} from "@msa/codemode";
import { type McpClient, toLlmContent } from "@msa/mcp";
import { Effect, Function, Schema } from "effect";
import { Type } from "typebox";

type Tool = Awaited<ReturnType<McpClient["listTools"]>>[number];

type RunTool = (name: string, args: unknown, signal: AbortSignal) => Promise<AgentToolCallOutcome>;

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const toToolName = (prefix: string, name: string): string =>
  `${prefix}_${name}`.replaceAll(/[^A-Za-z0-9_-]/gu, "_").slice(0, 64);

const textOf = (result: AgentToolResult<unknown>): string =>
  result.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");

const callMcpTool =
  (client: McpClient, tool: Tool): AgentTool["execute"] =>
  (_toolCallId, params, signal, onUpdate) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          client.callTool(tool.name, params as Record<string, unknown>, {
            onProgress: (progress) => {
              const text = progress.message ?? `Progress ${progress.progress}`;
              onUpdate?.({ content: [{ text, type: "text" }], details: undefined });
            },
            signal,
          }),
        );
        const content = toLlmContent(result);
        if (result.isError === true && content.length === 0) {
          content.push({ text: `MCP tool ${tool.name} failed`, type: "text" });
        }
        return {
          content,
          details: undefined,
          ...(result.structuredContent === undefined
            ? {}
            : { structuredContent: result.structuredContent as JsonValue }),
          isError: result.isError === true,
        };
      }),
    );

const toAgentTool = (client: McpClient, prefix: string, tool: Tool): AgentTool => ({
  description: tool.description ?? tool.title ?? `MCP tool ${tool.name}`,
  execute: callMcpTool(client, tool),
  label: tool.title ?? tool.name,
  name: toToolName(prefix, tool.name),
  parameters: Type.Unsafe(
    Object.assign({}, tool.inputSchema, {
      properties: tool.inputSchema["properties"] ?? {},
      type: "object",
    }),
  ),
  ...(tool.outputSchema === undefined
    ? {}
    : { outputSchema: Type.Unsafe<Record<string, unknown>>(tool.outputSchema) }),
});

const createMcpTools: {
  (prefix: string): (client: McpClient) => Promise<AgentTool[]>;
  (client: McpClient, prefix: string): Promise<AgentTool[]>;
} = Function.dual(2, (client: McpClient, prefix: string): Promise<AgentTool[]> =>
  client.listTools().then((tools) => tools.map((tool) => toAgentTool(client, prefix, tool))),
);

function createNestedToolRunner(agent: Agent): RunTool {
  let nextId = 1;
  return (name, args, signal) => {
    const assistantMessage = agent.state.messages.findLast(
      (message) => message.role === "assistant",
    );
    if (assistantMessage?.role !== "assistant")
      throw new Error("Nested tool calls need an assistant message");
    const tools = agent.state.tools;
    return runToolCall(
      { arguments: (args ?? {}) as JsonObject, id: `nested-${nextId++}`, name, type: "toolCall" },
      {
        afterToolCall: agent.afterToolCall,
        assistantMessage,
        beforeToolCall: agent.beforeToolCall,
        context: { messages: agent.state.messages, tools },
        signal,
        tools,
      },
    );
  };
}

const CODEMODE_TOOL_NAME = "codemode";

const codemodeParameters = Type.Object({
  code: Type.String({ description: "JavaScript source. Top-level await and return work." }),
});

const toSandboxTool = (tool: AgentTool, runTool: RunTool): CodemodeTool => ({
  description: tool.description,
  execute: (args, { signal }) =>
    runTool(tool.name, args, signal).then((outcome) => {
      if (tool.outputSchema !== undefined && outcome.result.structuredContent !== undefined) {
        return outcome.result.structuredContent;
      }
      const text = textOf(outcome.result);
      if (outcome.isError) throw new Error(text === "" ? `Tool ${tool.name} failed` : text);
      return text;
    }),
  inputSchema: tool.parameters as CodemodeJsonSchema,
  name: tool.name,
  outputSchema: (tool.outputSchema as CodemodeJsonSchema | undefined) ?? { type: "string" },
});

const resultContent = (result: CodemodeResult): Effect.Effect<(TextContent | ImageContent)[]> =>
  Effect.gen(function* () {
    const content: (TextContent | ImageContent)[] = [...result.output];
    if (result.ok && result.value !== undefined) {
      const value =
        typeof result.value === "string"
          ? result.value
          : yield* Effect.orDie(encodeJson(result.value));
      content.push({ text: value, type: "text" });
    }
    if (!result.ok) {
      content.push({
        text: `Script failed: ${result.error.stack ?? result.error.message}`,
        type: "text",
      });
    }
    return content;
  });

const runScript =
  (sandboxTools: CodemodeTool[]): AgentTool<typeof codemodeParameters>["execute"] =>
  (_toolCallId, params, signal) =>
    Effect.runPromise(
      Effect.acquireUseRelease(
        Effect.sync(() => new CodemodeSandbox({ timeoutMs: 120_000, tools: sandboxTools })),
        (sandbox) =>
          Effect.flatMap(
            Effect.promise(() => sandbox.execute(params.code, { signal })),
            (result) =>
              Effect.map(resultContent(result), (content) => ({
                content,
                details: { calls: result.calls },
                isError: !result.ok,
              })),
          ),
        (sandbox) => Effect.promise(() => sandbox.close()),
      ),
    );

const describeCodemode = (sandboxTools: CodemodeTool[]): string =>
  [
    "Run JavaScript that calls other tools, to chain calls, run them in parallel, or filter large results.",
    "The code is the body of an async function. There is no Node, file system, network, or timers.",
    "Call tools as `await tools.<name>(args)`. Output with `text(value)` or `console.log()`, or `return` a value.",
    "Only the output and the return value reach you, not the results of the tool calls.",
    "",
    "```ts",
    renderDeclarations({ tools: sandboxTools }),
    "```",
  ].join("\n");

const createCodemodeTool: {
  (runTool: RunTool): (tools: readonly AgentTool[]) => AgentTool<typeof codemodeParameters>;
  (tools: readonly AgentTool[], runTool: RunTool): AgentTool<typeof codemodeParameters>;
} = Function.dual(
  2,
  (tools: readonly AgentTool[], runTool: RunTool): AgentTool<typeof codemodeParameters> => {
    const sandboxTools = tools
      .filter((tool) => tool.name !== CODEMODE_TOOL_NAME)
      .map((tool) => toSandboxTool(tool, runTool));
    return {
      description: describeCodemode(sandboxTools),
      execute: runScript(sandboxTools),
      label: "Codemode",
      name: CODEMODE_TOOL_NAME,
      parameters: codemodeParameters,
    };
  },
);

const toolsModule = {
  CODEMODE_TOOL_NAME,
  createCodemodeTool,
  createMcpTools,
  createNestedToolRunner,
};

export default toolsModule;
