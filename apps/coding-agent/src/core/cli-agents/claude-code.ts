import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";

import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getCurrentSystemPrompt, getCurrentTools } from "@msa/ai/compat";
import type {
  AssistantMessage,
  JsonObject,
  Message,
  Model,
  Provider,
  SimpleStreamOptions,
  Tool,
  ToolResultMessage,
  TranscriptContext,
  UserMessage,
} from "@msa/ai/compat";

import {
  accountEnv,
  blockIfUnusable,
  blockOf,
  claudeExecutable,
  loadAccounts,
  type Account,
  type RunFailure,
} from "./claude-accounts.ts";
import { cliAgentProvider, type CliAgentModel } from "./provider.ts";
import { createReply, type ReplyBuilder } from "./reply.ts";
import { flattenTranscript, textFromContent } from "./transcript.ts";

const PROVIDER_ID = "claude-subs";
const SERVER = "msa";
const TOOL_PREFIX = `mcp__${SERVER}__`;
const IDLE_CLOSE_MS = 30 * 60_000;

const MAX_IDLE_SESSIONS = 2;

const MODELS = [
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
] as const;

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORT: Record<string, Effort> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const loadSdk = (() => {
  let loaded:
    | Promise<{
        query: typeof import("@anthropic-ai/claude-agent-sdk").query;
        usageLimitPrefixes: typeof import("@anthropic-ai/claude-agent-sdk").USAGE_LIMIT_ERROR_PREFIXES;
        McpServer: typeof import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
        CallToolRequestSchema: typeof import("@modelcontextprotocol/sdk/types.js").CallToolRequestSchema;
        ListToolsRequestSchema: typeof import("@modelcontextprotocol/sdk/types.js").ListToolsRequestSchema;
      }>
    | undefined;
  return () => {
    loaded ??= Promise.all([
      import("@anthropic-ai/claude-agent-sdk"),
      import("@modelcontextprotocol/sdk/server/mcp.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]).then(([agent, mcp, types]) => ({
      query: agent.query,
      usageLimitPrefixes: agent.USAGE_LIMIT_ERROR_PREFIXES,
      McpServer: mcp.McpServer,
      CallToolRequestSchema: types.CallToolRequestSchema,
      ListToolsRequestSchema: types.ListToolsRequestSchema,
    }));
    return loaded;
  };
})();
type Sdk = Awaited<ReturnType<typeof loadSdk>>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function replyKey(content: Message["content"]): string {
  return hash(textFromContent(content));
}

function toAnthropicContent(content: UserMessage["content"]): ContentBlockParam[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image",
          source: { type: "base64", media_type: part.mimeType as ImageMediaType, data: part.data },
        },
  );
}

function toCallToolResult(result: ToolResultMessage): CallToolResult {
  const content = result.content.map((part) =>
    part.type === "image"
      ? { type: "image" as const, data: part.data, mimeType: part.mimeType }
      : { type: "text" as const, text: part.text },
  );
  return { content, isError: result.isError };
}

class Input implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private closed = false;

  push(content: ContentBlockParam[], priority?: SDKUserMessage["priority"]): void {
    this.queue.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      ...(priority ? { priority } : {}),
    });
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }
}

interface SessionConfig {
  accounts: Account[];
  model: string;
  effort: Effort | undefined;
  systemPrompt: string;
  tools: Tool[];
}

const sessions = new Set<Session>();

class Session {
  readonly account: Account;
  readonly systemKey: string;
  readonly effort: Effort | undefined;
  private model: string;
  private tools: Tool[];
  private readonly input = new Input();
  private readonly server: McpServer;
  private readonly query: Query;
  private readonly events: AsyncIterator<SDKMessage>;

  readonly pending = new Set<string>();
  private readonly waiting = new Map<string, (result: CallToolResult) => void>();
  private readonly ready = new Map<string, CallToolResult>();
  lastReply = "";
  private busyFlag = false;
  lastUsed = Date.now();
  private child: ChildProcess | undefined;
  private stderrTail = "";
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(sdk: Sdk, config: SessionConfig, account: Account, env: Record<string, string>) {
    this.account = account;
    this.systemKey = hash(config.systemPrompt);
    this.effort = config.effort;
    this.model = config.model;
    this.tools = config.tools;

    this.server = new sdk.McpServer(
      { name: SERVER, version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    this.server.server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({
      tools: this.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: JSON.parse(JSON.stringify(tool.parameters)),
        _meta: { "anthropic/alwaysLoad": true },
      })),
    }));
    this.server.server.setRequestHandler(sdk.CallToolRequestSchema, async (request) => {
      const id = request.params._meta?.["claudecode/toolUseId"];
      if (typeof id !== "string") {
        return {
          content: [{ type: "text", text: "tool call without a tool use id" }],
          isError: true,
        };
      }
      const result = this.ready.get(id);
      if (result) {
        this.ready.delete(id);
        return result;
      }
      return new Promise<CallToolResult>((resolve) => this.waiting.set(id, resolve));
    });

    const executable = claudeExecutable();
    this.query = sdk.query({
      prompt: this.input,
      options: {
        model: config.model,
        ...(config.effort ? { effort: config.effort } : {}),
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
        systemPrompt: config.systemPrompt,
        tools: [],
        settingSources: [],
        mcpServers: { [SERVER]: { type: "sdk", name: SERVER, instance: this.server } },
        allowedTools: [`mcp__${SERVER}`],
        includePartialMessages: true,
        persistSession: false,
        cwd: process.cwd(),
        env,
        spawnClaudeCodeProcess: (spawnOptions) => {
          const child = spawn(spawnOptions.command, spawnOptions.args, {
            cwd: spawnOptions.cwd,
            env: spawnOptions.env,
            signal: spawnOptions.signal,
            stdio: ["pipe", "pipe", "pipe"],
          });
          child.stderr.on("data", (chunk: Buffer) => {
            this.stderrTail = (this.stderrTail + String(chunk)).slice(-2_000);
          });
          this.child = child;
          this.holdOpen(this.busyFlag);
          return child as never;
        },
      },
    });
    this.events = this.query[Symbol.asyncIterator]();
    sessions.add(this);
  }

  get busy(): boolean {
    return this.busyFlag;
  }

  set busy(value: boolean) {
    this.busyFlag = value;
    this.holdOpen(value);
  }

  private holdOpen(hold: boolean): void {
    const child = this.child;
    if (!child) return;
    for (const handle of [child, child.stdin, child.stdout, child.stderr] as Array<{
      ref?(): void;
      unref?(): void;
    } | null>) {
      if (hold) handle?.ref?.();
      else handle?.unref?.();
    }
  }

  get exitDetail(): string {
    return this.stderrTail.trim();
  }

  matches(config: SessionConfig): boolean {
    return (
      config.accounts.some((account) => account.name === this.account.name) &&
      this.systemKey === hash(config.systemPrompt) &&
      this.effort === config.effort
    );
  }

  async update(config: SessionConfig): Promise<void> {
    if (config.model !== this.model) {
      this.model = config.model;
      await this.query.setModel(config.model);
    }
    const names = (tools: Tool[]) =>
      JSON.stringify(tools.map((tool) => [tool.name, tool.description]));
    if (names(config.tools) !== names(this.tools)) {
      this.tools = config.tools;
      await this.server.server.sendToolListChanged();
    }
  }

  send(content: ContentBlockParam[], priority?: SDKUserMessage["priority"]): void {
    this.input.push(content, priority);
  }

  deliver(id: string, result: CallToolResult): void {
    this.pending.delete(id);
    const resolve = this.waiting.get(id);
    if (resolve) {
      this.waiting.delete(id);
      resolve(result);
    } else {
      this.ready.set(id, result);
    }
  }

  next(): Promise<IteratorResult<SDKMessage>> {
    return this.events.next();
  }

  interrupt(): void {
    void this.query.interrupt().catch(() => {});
  }

  touch(): void {
    this.lastUsed = Date.now();
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
    this.idleTimer.unref();
  }

  close(): void {
    if (!sessions.delete(this)) return;
    clearTimeout(this.idleTimer);
    for (const resolve of this.waiting.values()) {
      resolve({ content: [{ type: "text", text: "session closed" }], isError: true });
    }
    this.waiting.clear();
    this.input.close();
    this.query.close();
  }
}

async function attach(messages: readonly Message[], config: SessionConfig): Promise<Session> {
  let tail = messages.length;
  while (tail > 0 && messages[tail - 1]?.role !== "assistant") tail -= 1;
  const newTurns = messages.slice(tail);
  const toolResults = newTurns.filter(
    (message): message is ToolResultMessage => message.role === "toolResult",
  );
  const userTurns = newTurns.filter((message): message is UserMessage => message.role === "user");
  const last = messages[tail - 1] as AssistantMessage | undefined;

  for (const session of sessions) {
    if (session.busy || !session.matches(config)) continue;
    const answersPending =
      toolResults.length > 0 &&
      toolResults.every((result) => session.pending.has(result.toolCallId));
    const continuesReply =
      toolResults.length === 0 &&
      userTurns.length > 0 &&
      session.pending.size === 0 &&
      last !== undefined &&
      last.provider.startsWith(PROVIDER_ID) &&
      session.lastReply === replyKey(last.content);
    if (!answersPending && !continuesReply) continue;

    session.busy = true;
    await session.update(config);
    const userContent = userTurns.flatMap((turn) => toAnthropicContent(turn.content));
    if (answersPending) {
      if (userContent.length > 0) session.send(userContent, "next");
      for (const result of toolResults)
        session.deliver(result.toolCallId, toCallToolResult(result));
    } else {
      session.send(userContent);
    }
    return session;
  }

  const answered = new Set(
    messages.flatMap((message) => (message.role === "toolResult" ? [message.toolCallId] : [])),
  );
  for (const session of sessions) {
    if (!session.busy && [...session.pending].some((id) => answered.has(id))) session.close();
  }

  const idle = [...sessions]
    .filter((session) => !session.busy && session.pending.size === 0)
    .sort((a, b) => b.lastUsed - a.lastUsed);
  for (const session of idle.slice(MAX_IDLE_SESSIONS - 1)) session.close();

  const account = config.accounts[0];
  if (!account) throw new Error("No Claude account available");
  const session = new Session(await loadSdk(), config, account, await accountEnv(account));
  session.busy = true;
  session.send([
    {
      type: "text",
      text: [
        "The transcript below is the conversation so far. Continue it as the assistant.",
        "",
        "----- conversation transcript -----",
        "",
        flattenTranscript(messages),
        "",
        "----- end of transcript -----",
        "",
        "Reply now as the assistant to the last message.",
      ].join("\n"),
    },
  ]);
  return session;
}

async function pump(
  session: Session,
  reply: ReplyBuilder,
  model: Model<string>,
  options?: SimpleStreamOptions,
): Promise<RunFailure | undefined> {
  let messageId = "";
  let apiError: RunFailure["cause"];
  let rejectedResetsAt: number | undefined;
  let stopReason = "";
  let sawPartials = false;
  let calledTools = 0;
  let messageOutput = 0;

  while (true) {
    const next = await session.next();
    if (next.done) return { error: session.exitDetail || "Claude Code exited" };
    const event = next.value;
    try {
      await options?.onProviderStreamEvent?.(event, model);
    } catch {}

    if ("parent_tool_use_id" in event && event.parent_tool_use_id) continue;

    if (event.type === "stream_event") {
      sawPartials = true;
      const inner = event.event;
      if (inner.type === "message_start") {
        const usage = inner.message.usage;
        messageId = inner.message.id;
        messageOutput = 0;
        reply.addUsage({
          input: usage.input_tokens,
          cacheRead: usage.cache_read_input_tokens ?? 0,
          cacheWrite: usage.cache_creation_input_tokens ?? 0,
        });
      } else if (inner.type === "content_block_delta") {
        const key = `${messageId}:${inner.index}`;
        if (inner.delta.type === "text_delta") reply.appendText(key, inner.delta.text);
        else if (inner.delta.type === "thinking_delta")
          reply.appendThinking(key, inner.delta.thinking);
      } else if (inner.type === "message_delta") {
        if (inner.delta.stop_reason) stopReason = inner.delta.stop_reason;
        reply.addUsage({ output: inner.usage.output_tokens - messageOutput });
        messageOutput = inner.usage.output_tokens;
      } else if (inner.type === "message_stop" && stopReason === "tool_use" && calledTools > 0) {
        reply.done("toolUse");
        return undefined;
      }
    } else if (event.type === "assistant") {
      const message = event.message;

      if (message.model === "<synthetic>") {
        apiError = event.error;
        continue;
      }
      message.content.forEach((block, index) => {
        if (block.type === "tool_use" && block.name.startsWith(TOOL_PREFIX)) {
          session.pending.add(block.id);
          calledTools += 1;
          reply.toolCall(
            block.id,
            block.name.slice(TOOL_PREFIX.length),
            (block.input ?? {}) as JsonObject,
          );
        } else if (block.type === "text" && !sawPartials) {
          reply.setText(`${message.id}:${index}`, block.text);
        }
      });
    } else if (event.type === "rate_limit_event") {
      const info = event.rate_limit_info;

      if (info.status === "rejected") rejectedResetsAt = (info.resetsAt ?? 0) * 1000 || undefined;
    } else if (event.type === "result") {
      if (event.is_error) {
        const error = event.subtype === "success" ? event.result : event.errors.join("\n");
        const { usageLimitPrefixes } = await loadSdk();
        const limited =
          rejectedResetsAt !== undefined ||
          usageLimitPrefixes.some((prefix) => error.startsWith(prefix));
        return {
          error: error || "Claude Code run failed",
          ...(limited ? { cause: "usage_limit" } : apiError ? { cause: apiError } : {}),
          ...(rejectedResetsAt ? { resetsAt: rejectedResetsAt } : {}),
        };
      }
      reply.done("stop");
      session.lastReply = replyKey(reply.message.content);
      return undefined;
    }
  }
}

const streamFor =
  (fixed?: Account) =>
  (model: Model<string>, context: TranscriptContext, options?: SimpleStreamOptions) => {
    const reply = createReply(model);
    const messages = context.messages;
    const config: SessionConfig = {
      accounts: fixed
        ? [fixed]
        : loadAccounts().filter((account) => account.auto !== false && !blockOf(account)),
      model: model.id,
      effort: options?.reasoning ? EFFORT[options.reasoning] : undefined,
      systemPrompt: getCurrentSystemPrompt(messages),
      tools: getCurrentTools(messages),
    };

    void (async () => {
      let session: Session | undefined;
      const onAbort = () => {
        session?.interrupt();
        session?.close();
        reply.fail("aborted", "aborted");
      };
      if (options?.signal?.aborted) return onAbort();
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        try {
          await options?.onPayload?.(
            { provider: PROVIDER_ID, ...config, tools: config.tools.map((tool) => tool.name) },
            model,
          );
        } catch {}
        const failures: string[] = [];
        while (true) {
          let account = config.accounts[0];
          if (!account) {
            const failed = new Set(failures.map((line) => line.slice(0, line.indexOf(":"))));
            const blocked = loadAccounts()
              .filter((candidate) => candidate.auto !== false && !failed.has(candidate.name))
              .map((candidate) => `${candidate.name}: ${blockOf(candidate)?.reason ?? "?"}`);
            reply.fail(
              "error",
              `No Claude account available.\n${[...failures, ...blocked].join("\n")}`,
            );
            return undefined;
          }
          let failure: RunFailure | undefined;
          try {
            session = await attach(messages, config);
          } catch (error) {
            failure = { error: error instanceof Error ? error.message : String(error) };
          }
          if (session) {
            account = session.account;
            failure = await pump(session, reply, model, options);
            if (!failure || options?.signal?.aborted) return undefined;
            session.close();
            session = undefined;
          }
          if (!failure) return undefined;
          const failed = account;
          const blocked = blockIfUnusable(failed, failure);
          const detail = `${failed.name}: ${failure.error}`;
          failures.push(detail);
          if (fixed || !blocked || reply.hasContent) {
            reply.fail("error", detail);
            return undefined;
          }
          config.accounts = config.accounts.filter((candidate) => candidate.name !== failed.name);
        }
      } catch (error) {
        session?.close();
        reply.fail("error", error instanceof Error ? error.message : String(error));
        return undefined;
      } finally {
        options?.signal?.removeEventListener("abort", onAbort);
        if (session) {
          session.busy = false;
          session.touch();
        }
      }
    })();

    return reply.stream;
  };

const MODEL_LIMITS = {
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 1_000_000,
  maxTokens: 128_000,
} as const satisfies Omit<CliAgentModel, "id" | "name">;

function provider(id: string, name: string, account?: Account): Provider {
  return cliAgentProvider({
    id,
    name,
    models: MODELS.map((model) => ({ ...MODEL_LIMITS, id: model.id, name: model.name })),
    executable: claudeExecutable,
    streamSimple: streamFor(account),
  });
}

export function claudeCodeProviders(): Provider[] {
  const accounts = loadAccounts();
  return [
    provider(PROVIDER_ID, "Claude subscription"),
    ...(accounts.length > 1
      ? accounts.map((account) =>
          provider(
            `${PROVIDER_ID}-${account.name}`,
            `Claude subscription (${account.name})`,
            account,
          ),
        )
      : []),
  ];
}
