import type { AgentMessage, ThinkingLevel } from "@msa/agent-core";
import { Effect } from "effect";

import {
  currentTimeMillis,
  fromPromise,
  platformRuntime,
  randomHex,
  ToolFailure,
  unwrapForeign,
} from "../platform/index.ts";
import { SessionManager } from "../session-manager.ts";
import type { SessionNode, SessionNodeWithDependencies } from "./graph.ts";
import { OrchestratorCore } from "./orchestrator-core.ts";
import type {
  OrchestratorDefaults,
  OrchestratorOptions,
  StartSessionInput,
  StartSessionResult,
} from "./orchestrator-types.ts";

export { formatSessionList } from "./orchestrator-prompts.ts";
export type {
  CreateWorkerOptions,
  OrchestratorDefaults,
  OrchestratorOptions,
  OrchestratorReport,
  StartSessionInput,
  StartSessionResult,
  WorkerSession,
} from "./orchestrator-types.ts";

export const ORCHESTRATOR_REPORT_MESSAGE_TYPE = "msa.orchestrator.report";

interface NodeInput {
  round: number;
  defaults: OrchestratorDefaults;
  options: OrchestratorOptions;
}

function taskNode({
  id,
  input,
  model,
  round,
  defaults,
  options,
}: NodeInput & { id: string; input: StartSessionInput; model: string }): SessionNode {
  return {
    id,
    project: options.project,
    kind: "task",
    title: input.title,
    prompt: input.prompt,
    status: "queued",
    model,
    thinkingLevel: input.thinkingLevel ?? defaults.workerThinkingLevel,
    cwd: input.cwd ?? options.cwd,
    round,
    createdAt: currentTimeMillis(),
  };
}

function reviewNodeOf({ round, defaults, options }: NodeInput): SessionNode {
  return {
    id: `r-${randomHex(4)}`,
    project: options.project,
    kind: "review",
    title: `Review of round ${round}`,
    prompt: "",
    status: "queued",
    model: defaults.reviewModel,
    thinkingLevel: defaults.reviewThinkingLevel,
    cwd: options.cwd,
    round,
    createdAt: currentTimeMillis(),
  };
}

export class Orchestrator {
  private readonly core: OrchestratorCore;
  private readonly transcripts = new Map<string, readonly AgentMessage[]>();

  constructor(options: OrchestratorOptions) {
    this.core = new OrchestratorCore(options);
  }

  get sessions(): readonly SessionNodeWithDependencies[] {
    return this.core.snapshot;
  }

  onChange(listener: () => void): () => void {
    this.core.listeners.add(listener);
    return () => this.core.listeners.delete(listener);
  }

  messages(id: string): readonly AgentMessage[] {
    const worker = this.core.workers.get(id);
    if (worker !== undefined) {
      const streaming = worker.state.streamingMessage;
      return streaming === undefined ? worker.messages : [...worker.messages, streaming];
    }
    const sessionFile = this.core.snapshot.find((node) => node.id === id)?.sessionFile;
    if (sessionFile === undefined || sessionFile === "") return [];
    let cached = this.transcripts.get(sessionFile);
    if (cached === undefined) {
      try {
        cached = SessionManager.open(sessionFile).buildSessionContext().messages;
      } catch {
        cached = [];
      }
      this.transcripts.set(sessionFile, cached);
    }
    return cached;
  }

  progress(id: string): { startedAt: number | undefined; retrying: boolean } {
    return {
      startedAt: this.core.runs.has(id) ? this.core.runStartedAt.get(id) : undefined,
      retrying: this.core.workers.get(id)?.isRetrying ?? false,
    };
  }

  refresh(): Promise<void> {
    return platformRuntime.runPromise(this.core.refresh());
  }

  list(): Promise<SessionNodeWithDependencies[]> {
    return this.run(
      Effect.gen({ self: this }, function* () {
        const graph = yield* this.core.connect();
        return yield* fromPromise(() => graph.list(this.core.options.project));
      }),
    );
  }

  read(id: string): Promise<SessionNodeWithDependencies> {
    return this.run(
      Effect.gen({ self: this }, function* () {
        return yield* this.core.node(yield* this.core.connect(), id);
      }),
    );
  }

  start(input: StartSessionInput): Promise<StartSessionResult> {
    return this.run(this.core.locked(this.startEffect(input)));
  }

  send(id: string, message: string): Promise<SessionNodeWithDependencies> {
    return this.run(this.core.locked(this.sendEffect(id, message)));
  }

  setModel(id: string, model: string, thinkingLevel?: ThinkingLevel): Promise<SessionNode> {
    return this.run(this.core.locked(this.setModelEffect(id, model, thinkingLevel)));
  }

  stop(id: string): Promise<SessionNode> {
    return this.run(this.core.locked(this.stopEffect(id)));
  }

  dispose(): Promise<void> {
    return this.run(this.core.disposeAll());
  }

  private run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    return platformRuntime.runPromise(unwrapForeign(effect));
  }

  private startEffect(input: StartSessionInput) {
    return Effect.gen({ self: this }, function* () {
      const { core } = this;
      const { options } = core;
      const graph = yield* core.connect();
      const defaults = options.defaults();
      const model = input.model ?? defaults.workerModel;
      options.resolveModel(model);
      const nodes = yield* fromPromise(() => graph.list(options.project));
      const reviews = nodes.filter((node) => node.kind === "review");
      let review = reviews.find((node) => node.status === "queued");
      if (review !== undefined && input.dependsOn.includes(review.id)) {
        return yield* new ToolFailure({
          message: `${review.id} is the review that closes the current round; it already depends on this session.`,
        });
      }
      const round = review?.round ?? Math.max(0, ...reviews.map((node) => node.round)) + 1;
      const id = `s-${randomHex(4)}`;
      yield* fromPromise(() =>
        graph.add(taskNode({ id, input, model, round, defaults, options }), input.dependsOn),
      );
      if (review === undefined) {
        const reviewNode = reviewNodeOf({ round, defaults, options });
        yield* fromPromise(() => graph.add(reviewNode, []));
        review = { ...reviewNode, dependsOn: [] };
      }
      yield* core.relinkReview(graph, review.id, round);
      yield* core.schedule(graph);
      return {
        session: yield* core.node(graph, id),
        review: yield* core.node(graph, review.id),
      };
    });
  }

  private sendEffect(id: string, message: string) {
    return Effect.gen({ self: this }, function* () {
      const { core } = this;
      const graph = yield* core.connect();
      const node = yield* core.node(graph, id);
      const worker = core.workers.get(id);
      if (core.runs.has(id) && worker?.isStreaming === true) {
        yield* fromPromise(() => worker.steer(message));
        return node;
      }
      if (node.status === "queued") {
        return yield* new ToolFailure({
          message: `${id} is queued until its dependencies complete; it has not started yet.`,
        });
      }
      const nodes = yield* fromPromise(() => graph.list(core.options.project));
      if (nodes.some((other) => other.kind === "review" && other.status === "running")) {
        return yield* new ToolFailure({
          message: "A review is running alone; wait for its report.",
        });
      }
      const review =
        node.kind === "task"
          ? nodes.find((other) => other.kind === "review" && other.round === node.round)
          : undefined;
      if (review !== undefined && review.status !== "queued" && review.status !== "stopped") {
        return yield* new ToolFailure({
          message: `Round ${node.round} has been reviewed. Start a new session (it joins the next round) instead of reopening ${id}.`,
        });
      }
      yield* core.runNode(graph, node, message);
      if (review !== undefined) {
        if (review.status === "stopped") {
          yield* fromPromise(() => graph.update(review.id, { status: "queued" }));
        }
        yield* core.relinkReview(graph, review.id, node.round);
      }
      return yield* core.node(graph, id);
    });
  }

  private setModelEffect(id: string, model: string, thinkingLevel: ThinkingLevel | undefined) {
    return Effect.gen({ self: this }, function* () {
      const { core } = this;
      const graph = yield* core.connect();
      const node = yield* core.node(graph, id);
      const resolved = core.options.resolveModel(model);
      const worker = core.workers.get(id);
      if (worker !== undefined) {
        yield* fromPromise(() => worker.setModel(resolved));
        if (thinkingLevel !== undefined) worker.setThinkingLevel(thinkingLevel);
      }
      yield* fromPromise(() =>
        graph.update(id, { model, thinkingLevel: thinkingLevel ?? node.thinkingLevel }),
      );
      return yield* core.node(graph, id);
    });
  }

  private stopEffect(id: string) {
    return Effect.gen({ self: this }, function* () {
      const { core } = this;
      const graph = yield* core.connect();
      const node = yield* core.node(graph, id);
      if (node.status === "running" || node.status === "queued") {
        core.runs.delete(id);
        const worker = core.workers.get(id);
        if (worker !== undefined) {
          platformRuntime.runFork(fromPromise(() => worker.abort()).pipe(Effect.ignore));
        }
        yield* fromPromise(() => graph.update(id, { status: "stopped" }));
        if (node.kind === "task") yield* core.relinkReviewOfRound(graph, node.round);
        yield* core.schedule(graph);
      }
      return yield* core.node(graph, id);
    });
  }
}
