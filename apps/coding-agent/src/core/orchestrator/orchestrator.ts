import { randomUUID } from "node:crypto";

import type { AgentMessage, ThinkingLevel } from "@msa/agent-core";
import type { AssistantMessage, Model } from "@msa/ai/compat";

import { toErrorMessage } from "../../utils/errors.ts";
import type { AgentSession } from "../agent-session.ts";
import type {
  SessionGraph,
  SessionKind,
  SessionNode,
  SessionNodeWithDependencies,
  SessionStatus,
} from "./graph.ts";

export type WorkerSession = Pick<
  AgentSession,
  | "prompt"
  | "steer"
  | "abort"
  | "setModel"
  | "setThinkingLevel"
  | "isStreaming"
  | "messages"
  | "sessionFile"
  | "dispose"
>;

export interface CreateWorkerOptions {
  cwd: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  /** Reopen this transcript instead of starting a new one. */
  sessionFile?: string;
}

export interface OrchestratorDefaults {
  /** `provider/id` */
  workerModel: string;
  workerThinkingLevel: ThinkingLevel;
  /** `provider/id` */
  reviewModel: string;
  reviewThinkingLevel: ThinkingLevel;
  maxConcurrentSessions: number;
}

export interface OrchestratorReport {
  sessionId: string;
  kind: SessionKind;
  status: SessionStatus;
  started: string[];
}

export interface OrchestratorOptions {
  /** The orchestrator session id. Every session it starts belongs to this project. */
  project: string;
  cwd: string;
  connectGraph: () => Promise<SessionGraph>;
  createWorker: (options: CreateWorkerOptions) => Promise<WorkerSession>;
  /** Resolves `provider/id`, throwing for unknown models. */
  resolveModel: (reference: string) => Model<any>;
  defaults: () => OrchestratorDefaults;
  /** Delivers a session's outcome to the orchestrator conversation. */
  report: (text: string, details: OrchestratorReport) => void;
}

export interface StartSessionInput {
  title: string;
  prompt: string;
  dependsOn: readonly string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  cwd?: string;
}

export interface StartSessionResult {
  session: SessionNodeWithDependencies;
  review: SessionNodeWithDependencies;
}

export const ORCHESTRATOR_REPORT_MESSAGE_TYPE = "msa.orchestrator.report";

const REPORT_LIMIT = 4000;

function lastAssistant(messages: readonly AgentMessage[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "assistant") return message as AssistantMessage;
  }
  return undefined;
}

function assistantText(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function truncate(text: string, limit = REPORT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars; use read_session for the full report]`;
}

function describeNode(node: SessionNodeWithDependencies): string {
  const dependsOn = node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "-";
  return `${node.id} [${node.kind}, round ${node.round}] ${node.status} — ${node.title} (model ${node.model}, thinking ${node.thinkingLevel}; depends on ${dependsOn})`;
}

export function formatSessionList(nodes: readonly SessionNodeWithDependencies[]): string {
  if (nodes.length === 0) return "No sessions.";
  return nodes.map(describeNode).join("\n");
}

function reviewPrompt(round: number, nodes: readonly SessionNodeWithDependencies[]): string {
  const reports = nodes
    .filter((node) => node.kind === "task" && node.round === round)
    .map(
      (node) =>
        `<session id="${node.id}" title="${node.title}" status="${node.status}">\n${node.report ?? "(no report)"}\n</session>`,
    );
  return [
    `You are the closing reviewer of round ${round} of an orchestrated project. Every session of the round has finished, and nothing else runs while you work.`,
    "Step back and review the work as a whole, not session by session: check the results against each other and against the original intent, read the code and files they changed, and find gaps, conflicts, duplicated work, and wrong assumptions.",
    "Then redesign: say what should change in the overall approach and lay out the remaining work as independent sessions with their dependencies, so the orchestrator can start the next round. If nothing is left, say so.",
    "",
    "<dependency-graph>",
    formatSessionList(nodes),
    "</dependency-graph>",
    "",
    ...reports,
  ].join("\n");
}

function taskPrompt(
  node: SessionNode,
  dependencies: readonly SessionNodeWithDependencies[],
): string {
  if (dependencies.length === 0) return node.prompt;
  const reports = dependencies.map(
    (dependency) =>
      `<session id="${dependency.id}" title="${dependency.title}">\n${dependency.report ?? "(no report)"}\n</session>`,
  );
  return [node.prompt, "", "Reports of the sessions this task depends on:", "", ...reports].join(
    "\n",
  );
}

/**
 * Starts and tracks the sessions of one orchestrator conversation. Each session is an independent
 * {@link AgentSession} with its own model and thinking level. Sessions declare the sessions they
 * depend on and start once those have completed. Every round of sessions ends in one review
 * session, which depends on the round's sinks and runs alone.
 */
export class Orchestrator {
  private graph: Promise<SessionGraph> | undefined;
  private readonly workers = new Map<string, WorkerSession>();
  private readonly stopping = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  private readonly options: OrchestratorOptions;

  constructor(options: OrchestratorOptions) {
    this.options = options;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private connect(): Promise<SessionGraph> {
    this.graph ??= (async () => {
      const graph = await this.options.connectGraph();
      // Sessions of an earlier process ended with it.
      for (const node of await graph.list(this.options.project)) {
        if (node.status === "running") await graph.update(node.id, { status: "stopped" });
      }
      return graph;
    })();
    this.graph.catch(() => {
      this.graph = undefined;
    });
    return this.graph;
  }

  private async node(graph: SessionGraph, id: string): Promise<SessionNodeWithDependencies> {
    const node = await graph.get(id);
    if (!node || node.project !== this.options.project) throw new Error(`Unknown session: ${id}`);
    return node;
  }

  async list(): Promise<SessionNodeWithDependencies[]> {
    const graph = await this.connect();
    return graph.list(this.options.project);
  }

  async read(id: string): Promise<SessionNodeWithDependencies> {
    return this.node(await this.connect(), id);
  }

  start(input: StartSessionInput): Promise<StartSessionResult> {
    return this.exclusive(async () => {
      const graph = await this.connect();
      const defaults = this.options.defaults();
      const model = input.model ?? defaults.workerModel;
      this.options.resolveModel(model);
      const nodes = await graph.list(this.options.project);
      const reviews = nodes.filter((node) => node.kind === "review");
      let review = reviews.find((node) => node.status === "queued");
      if (review && input.dependsOn.includes(review.id)) {
        throw new Error(
          `${review.id} is the review that closes the current round; it already depends on this session.`,
        );
      }
      const round = review?.round ?? Math.max(0, ...reviews.map((node) => node.round)) + 1;
      const cwd = input.cwd ?? this.options.cwd;
      const id = `s-${randomUUID().slice(0, 8)}`;
      await graph.add(
        {
          id,
          project: this.options.project,
          kind: "task",
          title: input.title,
          prompt: input.prompt,
          status: "queued",
          model,
          thinkingLevel: input.thinkingLevel ?? defaults.workerThinkingLevel,
          cwd,
          round,
          createdAt: Date.now(),
        },
        input.dependsOn,
      );
      if (!review) {
        const reviewNode: SessionNode = {
          id: `r-${randomUUID().slice(0, 8)}`,
          project: this.options.project,
          kind: "review",
          title: `Review of round ${round}`,
          prompt: "",
          status: "queued",
          model: defaults.reviewModel,
          thinkingLevel: defaults.reviewThinkingLevel,
          cwd: this.options.cwd,
          round,
          createdAt: Date.now(),
        };
        await graph.add(reviewNode, []);
        review = { ...reviewNode, dependsOn: [] };
      }
      await this.relinkReview(graph, review.id, round);
      await this.schedule(graph);
      return {
        session: await this.node(graph, id),
        review: await this.node(graph, review.id),
      };
    });
  }

  send(id: string, message: string): Promise<SessionNodeWithDependencies> {
    return this.exclusive(async () => {
      const graph = await this.connect();
      const node = await this.node(graph, id);
      const worker = this.workers.get(id);
      if (node.status === "running" && worker?.isStreaming) {
        await worker.steer(message);
        return node;
      }
      if (node.status === "queued") {
        throw new Error(`${id} is queued until its dependencies complete; it has not started yet.`);
      }
      const nodes = await graph.list(this.options.project);
      if (nodes.some((other) => other.kind === "review" && other.status === "running")) {
        throw new Error("A review is running alone; wait for its report.");
      }
      if (node.kind === "task") {
        const review = nodes.find((other) => other.kind === "review" && other.round === node.round);
        if (review && review.status !== "queued") {
          throw new Error(
            `Round ${node.round} has been reviewed. Start a new session (it joins the next round) instead of reopening ${id}.`,
          );
        }
      }
      await this.run(graph, node, message);
      return this.node(graph, id);
    });
  }

  setModel(id: string, model: string, thinkingLevel?: ThinkingLevel): Promise<SessionNode> {
    return this.exclusive(async () => {
      const graph = await this.connect();
      const node = await this.node(graph, id);
      const resolved = this.options.resolveModel(model);
      const worker = this.workers.get(id);
      if (worker) {
        await worker.setModel(resolved);
        if (thinkingLevel) worker.setThinkingLevel(thinkingLevel);
      }
      await graph.update(id, { model, thinkingLevel: thinkingLevel ?? node.thinkingLevel });
      return this.node(graph, id);
    });
  }

  stop(id: string): Promise<SessionNode> {
    return this.exclusive(async () => {
      const graph = await this.connect();
      const node = await this.node(graph, id);
      if (node.status === "running") {
        this.stopping.add(id);
        await this.workers.get(id)?.abort();
        return node;
      }
      if (node.status === "queued") {
        await graph.update(id, { status: "stopped" });
        if (node.kind === "task") await this.relinkReviewOfRound(graph, node.round);
        await this.schedule(graph);
      }
      return this.node(graph, id);
    });
  }

  /** Aborts running sessions and releases the graph connection. */
  async dispose(): Promise<void> {
    for (const [id, worker] of this.workers) {
      this.stopping.add(id);
      await worker.abort();
      worker.dispose();
    }
    this.workers.clear();
    const graph = this.graph;
    this.graph = undefined;
    await (await graph?.catch(() => undefined))?.close();
  }

  private async relinkReviewOfRound(graph: SessionGraph, round: number): Promise<void> {
    const review = (await graph.list(this.options.project)).find(
      (node) => node.kind === "review" && node.round === round && node.status === "queued",
    );
    if (review) await this.relinkReview(graph, review.id, round);
  }

  private async relinkReview(graph: SessionGraph, reviewId: string, round: number): Promise<void> {
    const sinks = await graph.sinks(this.options.project, round);
    await graph.setDependencies(reviewId, sinks);
    if (sinks.length === 0) await graph.update(reviewId, { status: "stopped" });
  }

  /** Starts ready sessions: tasks up to the concurrency limit, a review only when nothing runs. */
  private async schedule(graph: SessionGraph): Promise<string[]> {
    const nodes = await graph.list(this.options.project);
    const running = nodes.filter((node) => node.status === "running");
    if (running.some((node) => node.kind === "review")) return [];
    const started: string[] = [];
    let capacity = this.options.defaults().maxConcurrentSessions - running.length;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const ready of await graph.ready(this.options.project)) {
      const node = byId.get(ready.id);
      if (!node) continue;
      if (node.kind === "review") {
        if (running.length > 0 || started.length > 0) continue;
        await this.run(graph, node, reviewPrompt(node.round, nodes));
        started.push(node.id);
        return started;
      }
      if (capacity <= 0) break;
      const dependencies = node.dependsOn.flatMap((dependencyId) => byId.get(dependencyId) ?? []);
      await this.run(graph, node, taskPrompt(node, dependencies));
      started.push(node.id);
      capacity--;
    }
    return started;
  }

  private async run(graph: SessionGraph, node: SessionNode, text: string): Promise<void> {
    let worker = this.workers.get(node.id);
    if (!worker) {
      worker = await this.options.createWorker({
        cwd: node.cwd,
        model: this.options.resolveModel(node.model),
        thinkingLevel: node.thinkingLevel,
        sessionFile: node.sessionFile,
      });
      this.workers.set(node.id, worker);
    }
    await graph.update(node.id, { status: "running", sessionFile: worker.sessionFile });
    const session = worker;
    void session.prompt(text).then(
      () => this.settle(node.id, session, undefined),
      (error: unknown) => this.settle(node.id, session, error),
    );
  }

  private settle(id: string, worker: WorkerSession, error: unknown): Promise<void> {
    return this.exclusive(async () => {
      const graph = await this.connect();
      const last = lastAssistant(worker.messages);
      let status: SessionStatus = "completed";
      let report = assistantText(last);
      if (this.stopping.delete(id)) {
        status = "stopped";
      } else if (error !== undefined) {
        status = "failed";
        report = toErrorMessage(error);
      } else if (last?.stopReason === "error" || last?.stopReason === "aborted") {
        status = "failed";
        report = [report, last.errorMessage].filter(Boolean).join("\n");
      }
      await graph.update(id, { status, report });
      const node = await this.node(graph, id);
      if (node.kind === "task" && status === "stopped") {
        await this.relinkReviewOfRound(graph, node.round);
      }
      const started = await this.schedule(graph);
      const nodes = await graph.list(this.options.project);
      const waiting = nodes.filter(
        (other) => other.status === "queued" && other.dependsOn.includes(id),
      );
      const lines = [
        `Session ${id} (${node.kind}: ${node.title}) ${status}.`,
        started.length > 0 ? `Started: ${started.join(", ")}.` : undefined,
        status !== "completed" && waiting.length > 0
          ? `Waiting on it: ${waiting.map((other) => other.id).join(", ")}. Send it a message to rerun it, or stop them.`
          : undefined,
        report ? `<session-report>\n${truncate(report)}\n</session-report>` : undefined,
      ];
      this.options.report(lines.filter(Boolean).join("\n\n"), {
        sessionId: id,
        kind: node.kind,
        status,
        started,
      });
    });
  }
}
