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
  prompts: string[] = [];
  steered: string[] = [];
  model: aiTypes.Model<any>;
  thinkingLevel: agentTypes.ThinkingLevel;
  telemetry: orchestratorTypes.CreateWorkerOptions["telemetry"];
  state: { streamingMessage?: agentTypes.AgentMessage } = {};
  private readonly pending: Array<{
    resolve: (reply: string) => void;
    reject: (error: unknown) => void;
  }> = [];

  constructor(options: orchestratorTypes.CreateWorkerOptions, index: number) {
    this.cwd = options.cwd;
    this.model = options.model;
    this.thinkingLevel = options.thinkingLevel;
    this.telemetry = options.telemetry;
    this.sessionFile = `/sessions/${index}.jsonl`;
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
      resolve: (reply) => {
        this.messages = [...this.messages, fauxAssistantMessage(reply)];
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

  complete(reply: string): void {
    this.pending.shift()?.resolve(reply);
  }

  fail(error: Error): void {
    this.pending.shift()?.reject(error);
  }
}
