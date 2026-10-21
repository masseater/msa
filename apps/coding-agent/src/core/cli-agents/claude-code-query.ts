import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type compatTypes from "@msa/ai/compat.types";

import nodeChildProcess from "../platform/node/child-process.ts";
import type nodeChildProcessTypes from "../platform/node/child-process.types.ts";
import claudeAccounts from "./claude-accounts.ts";
import type claudeCodeSdkTypes from "./claude-code-sdk.types.ts";
import type claudeCodeSessionTypes from "./claude-code-session.types.ts";

const { spawn } = nodeChildProcess;
const { claudeExecutable } = claudeAccounts;

const SERVER = "msa";

interface ToolServerHandlers {
  readonly tools: () => compatTypes.Tool[];
  readonly result: (toolUseId: string) => Promise<CallToolResult>;
}

interface QueryRequest {
  readonly config: claudeCodeSessionTypes.SessionConfig;
  readonly env: Record<string, string>;
  readonly server: McpServer;
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly onSpawn: (child: nodeChildProcessTypes.ChildProcess) => void;
}

const MISSING_TOOL_USE_ID: CallToolResult = {
  content: [{ text: "tool call without a tool use id", type: "text" }],
  isError: true,
};

function createToolServer(sdk: claudeCodeSdkTypes.Sdk, handlers: ToolServerHandlers): McpServer {
  const server = new sdk.McpServer(
    { name: SERVER, version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } },
  );
  server.server.setRequestHandler(sdk.ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: handlers.tools().map((tool) => ({
        ["_meta"]: { "anthropic/alwaysLoad": true },
        description: tool.description,
        inputSchema: JSON.parse(JSON.stringify(tool.parameters)),
        name: tool.name,
      })),
    }),
  );
  server.server.setRequestHandler(sdk.CallToolRequestSchema, (request) => {
    const id = request.params["_meta"]?.["claudecode/toolUseId"];
    return typeof id === "string" ? handlers.result(id) : Promise.resolve(MISSING_TOOL_USE_ID);
  });
  return server;
}

function startQuery(sdk: claudeCodeSdkTypes.Sdk, request: QueryRequest): Query {
  const { config, env, onSpawn, prompt, server } = request;
  const executable = claudeExecutable();
  return sdk.query({
    options: {
      allowedTools: [`mcp__${SERVER}`],
      cwd: process.cwd(),
      env,
      includePartialMessages: true,
      mcpServers: { [SERVER]: { instance: server, name: SERVER, type: "sdk" } },
      model: config.model,
      persistSession: false,
      settingSources: [],
      spawnClaudeCodeProcess: (spawnOptions) => {
        const child = spawn(spawnOptions.command, spawnOptions.args, {
          cwd: spawnOptions.cwd,
          env: spawnOptions.env,
          signal: spawnOptions.signal,
          stdio: ["pipe", "pipe", "pipe"],
        });
        onSpawn(child);
        return child as never;
      },
      systemPrompt: config.systemPrompt,
      tools: [],
      ...(config.effort === undefined ? {} : { effort: config.effort }),
      ...(executable === undefined || executable === ""
        ? {}
        : { pathToClaudeCodeExecutable: executable }),
    },
    prompt,
  });
}

const claudeCodeQuery = { SERVER, createToolServer, startQuery };

export default claudeCodeQuery;
