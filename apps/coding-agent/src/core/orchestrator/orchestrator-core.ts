import type { AssistantMessage } from "@msa/ai/compat";
import { contentText } from "@msa/ai/utils/text";
import { Effect, Option, Semaphore } from "effect";

import { toErrorMessage } from "../../utils/errors.ts";
import {
  currentTimeMillis,
  type ForeignError,
  fromPromise,
  platformRuntime,
  ToolFailure,
  unwrapForeign,
} from "../platform/index.ts";
import type {
  SessionGraph,
  SessionNode,
  SessionNodeWithDependencies,
  SessionStatus,
} from "./graph.ts";
import { reviewPrompt, taskPrompt, truncate } from "./orchestrator-prompts.ts";
import type { OrchestratorOptions, WorkerSession } from "./orchestrator-types.ts";

export class OrchestratorCore {
  readonly options: OrchestratorOptions;
  readonly workers = new Map<string, WorkerSession>();
  readonly runs = new Map<string, number>();
  readonly runStartedAt = new Map<string, number>();
  readonly listeners = new Set<() => void>();
  snapshot: SessionNodeWithDependencies[] = [];
  private graph: Promise<SessionGraph> | undefined;
  private runCount = 0;
  private readonly lock = Semaphore.makeUnsafe(1);

  constructor(options: OrchestratorOptions) {
    this.options = options;
  }

  locked<A, E>(effect: Effect.Effect<A, E>) {
    return this.lock.withPermits(1)(effect.pipe(Effect.ensuring(this.refresh())));
  }

  refresh() {
    return Effect.gen({ self: this }, function* () {
      const graph = yield* this.connect();
      this.snapshot = yield* fromPromise(() => graph.list(this.options.project));
      for (const listener of this.listeners) listener();
    }).pipe(Effect.ignore);
  }

  connect(): Effect.Effect<SessionGraph, ForeignError> {
    return Effect.suspend(() => {
      this.graph ??= platformRuntime.runPromise(
        unwrapForeign(
          this.openGraph().pipe(
            Effect.tapError(() =>
              Effect.sync(() => {
                this.graph = undefined;
              }),
            ),
          ),
        ),
      );
      const graph = this.graph;
      return fromPromise(() => graph);
    });
  }

  node(graph: SessionGraph, id: string) {
    return Effect.gen({ self: this }, function* () {
      const node = yield* fromPromise(() => graph.get(id));
      if (node === undefined || node.project !== this.options.project) {
        return yield* new ToolFailure({ message: `Unknown session: ${id}` });
      }
      return node;
    });
  }

  relinkReviewOfRound(graph: SessionGraph, round: number) {
    return Effect.gen({ self: this }, function* () {
      const nodes = yield* fromPromise(() => graph.list(this.options.project));
      const review = nodes.find(
        (node) => node.kind === "review" && node.round === round && node.status === "queued",
      );
      if (review !== undefined) yield* this.relinkReview(graph, review.id, round);
    });
  }

  relinkReview(graph: SessionGraph, reviewId: string, round: number) {
    return Effect.gen({ self: this }, function* () {
      const sinks = yield* fromPromise(() => graph.sinks(this.options.project, round));
      yield* fromPromise(() => graph.setDependencies(reviewId, sinks));
      if (sinks.length === 0) {
        yield* fromPromise(() => graph.update(reviewId, { status: "stopped" }));
      }
    });
  }

  schedule(graph: SessionGraph) {
    return Effect.gen({ self: this }, function* () {
      const nodes = yield* fromPromise(() => graph.list(this.options.project));
      const running = nodes.filter((node) => node.status === "running");
      if (running.some((node) => node.kind === "review")) return [];
      const started: string[] = [];
      let capacity = this.options.defaults().maxConcurrentSessions - running.length;
      const byId = new Map(nodes.map((node) => [node.id, node]));
      for (const ready of yield* fromPromise(() => graph.ready(this.options.project))) {
        const node = byId.get(ready.id);
        if (node === undefined) continue;
        if (node.kind === "review") {
          if (running.length > 0 || started.length > 0) continue;
          yield* this.runNode(graph, node, reviewPrompt(node.round, nodes));
          started.push(node.id);
          return started;
        }
        if (capacity <= 0) break;
        const dependencies = node.dependsOn.flatMap((id) => byId.get(id) ?? []);
        yield* this.runNode(graph, node, taskPrompt(node, dependencies));
        started.push(node.id);
        capacity--;
      }
      return started;
    });
  }

  runNode(graph: SessionGraph, node: SessionNode, text: string) {
    return Effect.gen({ self: this }, function* () {
      let worker = this.workers.get(node.id);
      if (worker === undefined) {
        const created = yield* fromPromise(() =>
          this.options.createWorker({
            cwd: node.cwd,
            model: this.options.resolveModel(node.model),
            thinkingLevel: node.thinkingLevel,
            sessionFile: node.sessionFile,
          }),
        );
        worker = created;
        this.workers.set(node.id, created);
        created.subscribe(() => {
          for (const listener of this.listeners) listener();
        });
      }
      yield* fromPromise(() =>
        graph.update(node.id, { status: "running", sessionFile: worker.sessionFile }),
      );
      const session = worker;
      const run = ++this.runCount;
      this.runs.set(node.id, run);
      this.runStartedAt.set(node.id, currentTimeMillis());
      this.watch(node.id, run, session, text);
    });
  }

  settleReport(id: string, run: number, worker: WorkerSession, error: unknown) {
    return this.locked(
      Effect.gen({ self: this }, function* () {
        if (this.runs.get(id) !== run) return;
        this.runs.delete(id);
        const graph = yield* this.connect();
        const { status, report } = this.outcome(worker, error);
        yield* fromPromise(() => graph.update(id, { status, report }));
        const node = yield* this.node(graph, id);
        const started = yield* this.schedule(graph);
        const nodes = yield* fromPromise(() => graph.list(this.options.project));
        const waiting = nodes.filter(
          (other) => other.status === "queued" && other.dependsOn.includes(id),
        );
        const lines = [
          `Session ${id} (${node.kind}: ${node.title}) ${status}.`,
          started.length > 0 ? `Started: ${started.join(", ")}.` : undefined,
          status !== "completed" && waiting.length > 0
            ? `Waiting on it: ${waiting.map((other) => other.id).join(", ")}. Send it a message to rerun it, or stop them.`
            : undefined,
          report === "" ? undefined : `<session-report>\n${truncate(report)}\n</session-report>`,
        ];
        this.options.report(lines.filter((line) => line !== undefined).join("\n\n"), {
          sessionId: id,
          kind: node.kind,
          status,
          started,
        });
      }),
    );
  }

  disposeAll() {
    return Effect.gen({ self: this }, function* () {
      this.runs.clear();
      for (const worker of this.workers.values()) {
        yield* fromPromise(() => worker.abort());
        worker.dispose();
      }
      this.workers.clear();
      const graph = this.graph;
      this.graph = undefined;
      if (graph === undefined) return;
      const opened = yield* fromPromise(() => graph).pipe(Effect.option);
      if (Option.isSome(opened)) yield* fromPromise(() => opened.value.close());
    });
  }

  private openGraph() {
    return Effect.gen({ self: this }, function* () {
      const graph = yield* fromPromise(() => this.options.connectGraph());
      for (const node of yield* fromPromise(() => graph.list(this.options.project))) {
        if (node.status === "running") {
          yield* fromPromise(() => graph.update(node.id, { status: "stopped" }));
        }
      }
      return graph;
    });
  }

  private watch(id: string, run: number, session: WorkerSession, text: string): void {
    platformRuntime.runFork(
      fromPromise(() => session.prompt(text)).pipe(
        Effect.matchEffect({
          onSuccess: () => this.settleReport(id, run, session, undefined),
          onFailure: (failure) => this.settleReport(id, run, session, failure.cause),
        }),
        Effect.ignore,
      ),
    );
  }

  private outcome(
    worker: WorkerSession,
    error: unknown,
  ): { status: SessionStatus; report: string } {
    const last = worker.messages.findLast(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    const lastText = last === undefined ? "" : contentText(last.content, "\n").trim();
    if (error !== undefined) return { status: "failed", report: toErrorMessage(error) };
    if (last?.stopReason === "error" || last?.stopReason === "aborted") {
      const report = [lastText, last.errorMessage].filter(
        (part) => part !== undefined && part !== "",
      );
      return { status: "failed", report: report.join("\n") };
    }
    return { status: "completed", report: lastText };
  }
}
