import { Effect } from "effect";

import platform from "../platform/index.ts";
import claudeCodeContent from "./claude-code-content.ts";
import Input from "./claude-code-input.ts";
import claudeCodeQuery from "./claude-code-query.ts";
import type claudeCodeSdkTypes from "./claude-code-sdk.types.ts";
import type claudeCodeSessionTypes from "./claude-code-session.types.ts";
import claudeCodeSessions from "./claude-code-sessions.ts";
import ToolResults from "./claude-code-tool-results.ts";

const { nowMs } = platform;
const { sha256Hex } = claudeCodeContent;
const { createToolServer, startQuery } = claudeCodeQuery;
const { sessions } = claudeCodeSessions;
const IDLE_CLOSE_MS = 30 * 60_000;

const SESSION_CLOSED: claudeCodeSessionTypes.CallToolResult = {
  content: [{ text: "session closed", type: "text" }],
  isError: true,
};

interface RefHandle {
  ref?(): void;
  unref?(): void;
}

const toolNames = (tools: claudeCodeSessionTypes.Tool[]) =>
  JSON.stringify(tools.map((tool) => [tool.name, tool.description]));

export default class Session {
  readonly account: claudeCodeSessionTypes.Account;
  readonly systemKey: string;
  readonly effort: claudeCodeSessionTypes.Effort | undefined;
  readonly pending = new Set<string>();
  lastReply = "";
  lastUsed = nowMs();
  private model: string;
  private tools: claudeCodeSessionTypes.Tool[];
  private readonly input = new Input();
  private readonly server: claudeCodeSessionTypes.McpServer;
  private readonly query: claudeCodeSessionTypes.Query;
  private readonly events: AsyncIterator<claudeCodeSessionTypes.SDKMessage>;
  private readonly results = new ToolResults();
  private busyFlag = false;
  private child: claudeCodeSessionTypes.ChildProcess | undefined;
  private stderrTail = "";

  constructor(
    sdk: claudeCodeSdkTypes.Sdk,
    config: claudeCodeSessionTypes.SessionConfig,
    account: claudeCodeSessionTypes.Account,
    env: Record<string, string>,
  ) {
    this.account = account;
    this.systemKey = sha256Hex(config.systemPrompt);
    this.effort = config.effort;
    this.model = config.model;
    this.tools = config.tools;
    this.server = createToolServer(sdk, {
      result: (id) => this.results.take(id),
      tools: () => this.tools,
    });
    this.query = startQuery(sdk, {
      config,
      env,
      onSpawn: (child) => this.adopt(child),
      prompt: this.input,
      server: this.server,
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

  get exitDetail(): string {
    return this.stderrTail.trim();
  }

  matches(config: claudeCodeSessionTypes.SessionConfig): boolean {
    return (
      config.accounts.some((account) => account.name === this.account.name) &&
      this.systemKey === sha256Hex(config.systemPrompt) &&
      this.effort === config.effort
    );
  }

  idleFor(now: number): boolean {
    return !this.busyFlag && now - this.lastUsed >= IDLE_CLOSE_MS;
  }

  update(config: claudeCodeSessionTypes.SessionConfig): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (config.model !== this.model) {
        this.model = config.model;
        yield* Effect.promise(() => this.query.setModel(config.model));
      }
      if (toolNames(config.tools) !== toolNames(this.tools)) {
        this.tools = config.tools;
        yield* Effect.promise(() => this.server.server.sendToolListChanged());
      }
    });
  }

  send(
    content: claudeCodeSessionTypes.ContentBlockParam[],
    priority?: claudeCodeSessionTypes.SDKUserMessage["priority"],
  ): void {
    this.input.push(content, priority);
  }

  deliver(id: string, result: claudeCodeSessionTypes.CallToolResult): void {
    this.pending.delete(id);
    this.results.give(id, result);
  }

  next(): Promise<IteratorResult<claudeCodeSessionTypes.SDKMessage>> {
    return this.events.next();
  }

  interrupt(): void {
    this.query.interrupt().catch(() => undefined);
  }

  touch(): void {
    this.lastUsed = nowMs();
  }

  close(): void {
    if (!sessions.delete(this)) return;
    this.results.closeAll(SESSION_CLOSED);
    this.input.close();
    this.query.close();
  }

  private adopt(child: claudeCodeSessionTypes.ChildProcess): void {
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + String(chunk)).slice(-2000);
    });
    this.child = child;
    this.holdOpen(this.busyFlag);
  }

  private holdOpen(hold: boolean): void {
    const child = this.child;
    if (child === undefined) return;
    const handles = [child, child.stdin, child.stdout, child.stderr] as (RefHandle | null)[];
    for (const handle of handles) {
      if (handle === null) continue;
      if (hold) handle.ref?.();
      else handle.unref?.();
    }
  }
}
