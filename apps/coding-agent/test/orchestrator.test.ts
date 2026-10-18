import type { AgentMessage } from "@msa/agent-core";
import { type Api, fauxAssistantMessage, type Model } from "@msa/ai";
import { describe, expect, it } from "vite-plus/test";

import {
  type CreateWorkerOptions,
  Orchestrator,
  type OrchestratorReport,
  type WorkerSession,
} from "../src/core/orchestrator/orchestrator.ts";
import { MemorySessionGraph } from "./orchestrator-memory-graph.ts";

function model(provider: string, id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "faux",
    provider,
    baseUrl: "",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 8192,
  };
}

const MODELS = [model("sub", "fable"), model("fast", "flash"), model("fast", "tiny")];

class FakeWorker implements WorkerSession {
  isStreaming = false;
  messages: AgentMessage[] = [];
  sessionFile: string;
  prompts: string[] = [];
  steered: string[] = [];
  model: Model<any>;
  thinkingLevel: string;
  /** When false, an aborted prompt keeps pending until `release()`, like one in a retry backoff. */
  abortReturns = true;
  private readonly pending: Array<{
    finish: (reply: string) => void;
    fail: (error: Error) => void;
  }> = [];

  constructor(options: CreateWorkerOptions, index: number) {
    this.model = options.model;
    this.thinkingLevel = options.thinkingLevel;
    this.sessionFile = `/sessions/${index}.jsonl`;
  }

  prompt = async (text: string) => {
    this.prompts.push(text);
    this.isStreaming = true;
    await new Promise<void>((resolve, reject) => {
      this.pending.push({
        finish: (reply) => {
          this.messages = [...this.messages, fauxAssistantMessage(reply)];
          resolve();
        },
        fail: reject,
      });
    });
    this.isStreaming = false;
  };

  steer = async (text: string) => {
    this.steered.push(text);
    return "queued" as never;
  };

  abort = async () => {
    this.isStreaming = false;
    if (this.abortReturns) this.pending.pop()?.fail(new Error("aborted"));
  };

  setModel = async (next: Model<any>) => {
    this.model = next;
  };

  setThinkingLevel = (level: string) => {
    this.thinkingLevel = level;
  };

  dispose = () => {};

  subscribe = () => () => {};

  state = {} as WorkerSession["state"];

  isRetrying = false;

  complete(reply: string) {
    this.pending.pop()?.finish(reply);
  }

  /** Lets the oldest pending prompt return. */
  release(reply: string) {
    this.pending.shift()?.finish(reply);
  }
}

function setup(maxConcurrentSessions = 4) {
  const graph = new MemorySessionGraph();
  const workers: FakeWorker[] = [];
  const reports: Array<{ text: string; details: OrchestratorReport }> = [];
  const orchestrator = new Orchestrator({
    project: "project",
    cwd: "/repo",
    connectGraph: async () => graph,
    createWorker: async (options) => {
      const worker = new FakeWorker(options, workers.length);
      workers.push(worker);
      return worker;
    },
    resolveModel: (reference) => {
      const found = MODELS.find(
        (candidate) => `${candidate.provider}/${candidate.id}` === reference,
      );
      if (!found) throw new Error(`"${reference}" is not an available model`);
      return found;
    },
    defaults: () => ({
      workerModel: "fast/flash",
      workerThinkingLevel: "low",
      reviewModel: "sub/fable",
      reviewThinkingLevel: "high",
      maxConcurrentSessions,
    }),
    report: (text, details) => reports.push({ text, details }),
  });
  const workerFor = (id: string) => {
    const node = graph.get(id);
    return node.then((found) =>
      workers.find((worker) => worker.sessionFile === found?.sessionFile),
    );
  };
  const settled = async (count: number) => {
    await expect.poll(() => reports.length).toBe(count);
  };
  return { graph, workers, reports, orchestrator, workerFor, settled };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

const task = (title: string, dependsOn: string[] = [], extra: object = {}) => ({
  title,
  prompt: `do ${title}`,
  dependsOn,
  ...extra,
});

describe("Orchestrator", () => {
  it("runs independent sessions in parallel with the worker default model", async () => {
    const { orchestrator, workers, reports, settled } = setup();
    const started = await Promise.all(
      ["a", "b", "c"].map((title) => orchestrator.start(task(title))),
    );
    expect(started.map(({ session }) => session.status)).toEqual(["running", "running", "running"]);
    expect(workers.map((worker) => worker.model.id)).toEqual(["flash", "flash", "flash"]);
    expect(workers.map((worker) => worker.thinkingLevel)).toEqual(["low", "low", "low"]);

    at(workers, 1).complete("b is done");
    await settled(1);
    expect(at(reports, 0).details).toMatchObject({ status: "completed", kind: "task" });
    expect(at(reports, 0).text).toContain("b is done");
    const list = await orchestrator.list();
    expect(list.map((node) => [node.title, node.status]).toSorted()).toEqual([
      ["Review of round 1", "queued"],
      ["a", "running"],
      ["b", "completed"],
      ["c", "running"],
    ]);
  });

  it("shows a running session's partial reply, run time, and retries", async () => {
    const { orchestrator, workers, settled } = setup();
    const { session } = await orchestrator.start(task("a"));
    const worker = at(workers, 0);
    const partial = fauxAssistantMessage("half way");
    worker.state = { streamingMessage: partial } as WorkerSession["state"];
    worker.isRetrying = true;
    expect(orchestrator.messages(session.id).at(-1)).toBe(partial);
    expect(orchestrator.progress(session.id)).toEqual({
      startedAt: expect.any(Number),
      retrying: true,
    });

    worker.complete("done");
    await settled(1);
    expect(orchestrator.progress(session.id).startedAt).toBeUndefined();
  });

  it("starts one task on a smaller model and switches a running one", async () => {
    const { orchestrator, workers, workerFor } = setup();
    const { session } = await orchestrator.start(task("small", [], { model: "fast/tiny" }));
    expect(at(workers, 0).model.id).toBe("tiny");

    await orchestrator.setModel(session.id, "sub/fable", "high");
    const worker = await workerFor(session.id);
    expect(worker?.model.id).toBe("fable");
    expect(worker?.thinkingLevel).toBe("high");
    expect(await orchestrator.read(session.id)).toMatchObject({
      model: "sub/fable",
      thinkingLevel: "high",
    });
    await expect(orchestrator.start(task("x", [], { model: "nope/none" }))).rejects.toThrow(
      /not an available model/,
    );
  });

  it("keeps a message to a waiting session and adds it to the prompt when it starts", async () => {
    const { orchestrator, workers, settled } = setup();
    const a = await orchestrator.start(task("a"));
    const b = await orchestrator.start(task("b", [a.session.id]));

    const queued = await orchestrator.send(b.session.id, "also update the docs");
    expect(queued.status).toBe("queued");
    expect(queued.pendingMessages).toEqual(["also update the docs"]);

    at(workers, 0).complete("a done");
    await settled(1);
    expect(at(workers, 1).prompts[0]).toContain("do b");
    expect(at(workers, 1).prompts[0]).toContain("also update the docs");
    expect(await orchestrator.read(b.session.id)).toMatchObject({ pendingMessages: [] });
  });

  it("keeps messages to a waiting review and adds them to its prompt", async () => {
    const { orchestrator, workers, settled } = setup();
    const a = await orchestrator.start(task("a"));
    await orchestrator.send(a.review.id, "focus on the public API");

    at(workers, 0).complete("a done");
    await settled(1);
    expect(at(workers, 1).prompts[0]).toContain("focus on the public API");
    expect(await orchestrator.read(a.review.id)).toMatchObject({ pendingMessages: [] });
  });

  it("waits for dependencies and passes their reports on", async () => {
    const { orchestrator, workers, settled } = setup();
    const a = await orchestrator.start(task("a"));
    const b = await orchestrator.start(task("b", [a.session.id]));
    expect(b.session.status).toBe("queued");
    expect(workers).toHaveLength(1);
    await expect(orchestrator.start(task("bad", ["s-missing"]))).rejects.toThrow(
      /Unknown sessions/,
    );

    at(workers, 0).complete("api is at /v2");
    await settled(1);
    expect(workers).toHaveLength(2);
    expect(at(workers, 1).prompts[0]).toContain("do b");
    expect(at(workers, 1).prompts[0]).toContain("api is at /v2");
  });

  it("ends every round in one review that depends on the sinks and runs alone", async () => {
    const { orchestrator, workers, reports, settled } = setup();
    const a = await orchestrator.start(task("a"));
    expect(a.review.dependsOn).toEqual([a.session.id]);
    const b = await orchestrator.start(task("b", [a.session.id]));
    expect(b.review.dependsOn).toEqual([b.session.id]);
    const c = await orchestrator.start(task("c"));
    expect(c.review.id).toBe(a.review.id);
    expect(c.review.dependsOn).toEqual([b.session.id, c.session.id].toSorted());
    await expect(orchestrator.start(task("loop", [a.review.id]))).rejects.toThrow(
      /closes the current round/,
    );

    at(workers, 0).complete("a done");
    await settled(1);
    at(workers, 1).complete("c done");
    await settled(2);
    expect(workers).toHaveLength(3);
    at(workers, 2).complete("b done");
    await settled(3);

    expect(workers).toHaveLength(4);
    const review = at(workers, 3);
    expect(review.model.id).toBe("fable");
    expect(review.thinkingLevel).toBe("high");
    expect(review.prompts[0]).toContain("redesign");
    expect(review.prompts[0]).toContain("a done");
    expect(at(reports, 2).details.started).toEqual([a.review.id]);

    const next = await orchestrator.start(task("d"));
    expect(next.session.round).toBe(2);
    expect(next.session.status).toBe("queued");
    expect(next.review.id).not.toBe(a.review.id);
    await expect(orchestrator.send(a.session.id, "again")).rejects.toThrow(/review is running/);

    review.complete("redesign: split d");
    await settled(4);
    expect(at(reports, 3).details).toMatchObject({ kind: "review", status: "completed" });
    expect(at(reports, 3).details.started).toEqual([next.session.id]);
    await expect(orchestrator.send(a.session.id, "again")).rejects.toThrow(/has been reviewed/);
  });

  it("holds sessions beyond the concurrency limit", async () => {
    const { orchestrator, workers, settled } = setup(2);
    for (const title of ["a", "b", "c"]) await orchestrator.start(task(title));
    expect(workers).toHaveLength(2);
    at(workers, 0).complete("done");
    await settled(1);
    expect(workers).toHaveLength(3);
  });

  it("stops sessions at once, reports waiting dependents, and reruns on a message", async () => {
    const { orchestrator, workers, reports, settled } = setup();
    const a = await orchestrator.start(task("a"));
    const b = await orchestrator.start(task("b", [a.session.id]));
    await orchestrator.send(a.session.id, "use the cache");
    expect(at(workers, 0).steered).toEqual(["use the cache"]);

    expect(await orchestrator.stop(a.session.id)).toMatchObject({ status: "stopped" });
    expect(await orchestrator.read(b.session.id)).toMatchObject({ status: "queued" });

    await orchestrator.send(a.session.id, "try again");
    expect(at(workers, 0).prompts.at(-1)).toBe("try again");
    at(workers, 0).complete("a done");
    await settled(1);
    expect(at(reports, 0).details).toMatchObject({ status: "completed", started: [b.session.id] });

    await orchestrator.stop(b.session.id);
    const review = (await orchestrator.list()).find((node) => node.kind === "review");
    expect(review?.dependsOn).toEqual([a.session.id]);
  });

  it("reports a failed session with the sessions waiting on it", async () => {
    const { orchestrator, workers, reports, settled } = setup();
    const a = await orchestrator.start(task("a"));
    const b = await orchestrator.start(task("b", [a.session.id]));
    at(workers, 0).abortReturns = true;
    await at(workers, 0).abort();
    await settled(1);
    expect(at(reports, 0).details.status).toBe("failed");
    expect(at(reports, 0).text).toContain(b.session.id);
  });

  it("ignores a stopped run that returns after the session was rerun", async () => {
    const { orchestrator, workers, reports, settled } = setup();
    const a = await orchestrator.start(task("a"));
    const worker = at(workers, 0);
    worker.abortReturns = false;
    await orchestrator.stop(a.session.id);
    await orchestrator.send(a.session.id, "again");

    worker.release("stale");
    worker.complete("fresh");
    await settled(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reports).toHaveLength(1);
    expect(at(reports, 0).text).toContain("fresh");
    expect(at(reports, 0).details.started).toEqual([a.review.id]);
  });
});
