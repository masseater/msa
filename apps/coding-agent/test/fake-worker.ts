import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";

const { fauxAssistantMessage } = ai;

export default class FakeWorker implements orchestratorTypes.WorkerSession {
  compaction = { manual: { isCompacting: false } };
  cwd: string;
  isStreaming = false;
  messages: agentTypes.AgentMessage[] = [];
  sessionFile: string;
  openedSessionFile: string | undefined;
  prompts: string[] = [];
  steered: string[] = [];
  model: aiTypes.Model<any>;
  thinkingLevel: agentTypes.ThinkingLevel;
  telemetry: orchestratorTypes.CreateWorkerOptions["telemetry"];
  tools: orchestratorTypes.CreateWorkerOptions["tools"];
  readOnly: boolean;
  state: { streamingMessage?: agentTypes.AgentMessage } = {};
  private readonly pending: Array<{
    resolve: (message: aiTypes.AssistantMessage) => void;
    reject: (error: unknown) => void;
  }> = [];

  constructor(options: orchestratorTypes.CreateWorkerOptions, index: number) {
    this.cwd = options.cwd;
    this.model = options.model;
    this.thinkingLevel = options.thinkingLevel;
    this.telemetry = options.telemetry;
    this.tools = options.tools;
    this.readOnly = options.readOnly;
    this.openedSessionFile = options.sessionFile;
    this.sessionFile = options.sessionFile ?? `/sessions/${index}.jsonl`;
  }

  prompt = (text: string) => {
    this.prompts.push(text);
    this.isStreaming = true;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.pending.push({
      reject: (error) => {
        this.isStreaming = false;
        reject(error);
      },
      resolve: (message) => {
        this.messages = [...this.messages, message];
        this.isStreaming = false;
        resolve();
      },
    });
    return promise;
  };

  steer = (text: string) => {
    this.steered.push(text);
    return Promise.resolve("queued");
  };

  abort = () => {
    this.isStreaming = false;
    this.pending.pop()?.reject(new Error("aborted"));
    return Promise.resolve();
  };

  setModel = (next: aiTypes.Model<any>) => {
    this.model = next;
    return Promise.resolve();
  };

  setThinkingLevel = (level: agentTypes.ThinkingLevel) => {
    this.thinkingLevel = level;
  };

  dispose = () => {};

  prWatchClosed = 0;

  readonly integrations = {
    prWatch: {
      close: () => {
        this.prWatchClosed++;
        return Promise.resolve();
      },
    },
  };

  readonly run = {
    lifecycle: { abort: () => this.abort() },
    prompting: { prompt: (text: string) => this.prompt(text) },
    queue: { steer: (text: string) => this.steer(text) },
    retry: { isRetrying: false },
  };

  readonly models = {
    selection: { setModel: (next: aiTypes.Model<any>) => this.setModel(next) },
    thinking: {
      setThinkingLevel: (level: agentTypes.ThinkingLevel) => this.setThinkingLevel(level),
    },
  };

  subscribe = () => () => {};

  private recorded = false;

  goalItemCount(): number | undefined {
    const tool = this.tools.find((candidate) => candidate.name === "record_goal_items");
    const items = (
      tool?.parameters as { properties?: { items?: { minItems?: number } } } | undefined
    )?.properties?.items;
    return items?.minItems;
  }

  recordGoalItems(
    items: readonly { item: number; status: "met" | "unmet"; evidence: string }[],
  ): Promise<unknown> {
    const tool = this.tools.find((candidate) => candidate.name === "record_goal_items");
    if (tool === undefined)
      return Promise.reject(new Error("this thread has no record_goal_items"));
    this.recorded = true;
    const execute = tool.execute as (callId: string, params: unknown) => Promise<unknown>;
    return execute("call", { items });
  }

  complete(reply: string): void {
    const count = this.goalItemCount();
    if (count !== undefined && !this.recorded) {
      void this.recordGoalItems(
        Array.from({ length: count }, (_, index) => ({
          evidence: "checked",
          item: index + 1,
          status: "met" as const,
        })),
      ).catch(() => undefined);
    }
    this.completeUnrecorded(reply);
  }

  completeUnrecorded(reply: string): void {
    this.recorded = false;
    this.pending.shift()?.resolve(fauxAssistantMessage(reply));
  }

  requestDecision(request: Record<string, unknown>, reply = ""): Promise<void> {
    const tool = this.tools.find((candidate) => candidate.name === "request_decision");
    if (tool === undefined) return Promise.reject(new Error("this thread has no request_decision"));
    const execute = tool.execute as (callId: string, params: unknown) => Promise<unknown>;
    return execute("call", request).then(() => this.completeUnrecorded(reply));
  }

  concludeTriage(conclusion: Record<string, unknown>, reply = ""): Promise<void> {
    const tool = this.tools.find((candidate) => candidate.name === "conclude_triage");
    if (tool === undefined) return Promise.reject(new Error("this thread has no conclude_triage"));
    const execute = tool.execute as (callId: string, params: unknown) => Promise<unknown>;
    return execute("call", {
      leavesLimitation: false,
      narrowsGoal: false,
      relaxesRule: false,
      ...conclusion,
    }).then(() => this.completeUnrecorded(reply));
  }

  escalate(): Promise<void> {
    return this.concludeTriage({
      conclusion: "needs-human",
      decision: "Which of the two to keep.",
      grounds: "Both options break a stated constraint.",
      humanReason: "undecided-spec",
      noPrecedent: "No commit, issue, or report chose between them.",
    });
  }

  fail(error: Error): void {
    this.pending.shift()?.reject(error);
  }

  endTurnWithError(failure: Partial<aiTypes.AssistantMessage>): void {
    this.pending
      .shift()
      ?.resolve({ ...fauxAssistantMessage("", { stopReason: "error" }), ...failure });
  }
}
