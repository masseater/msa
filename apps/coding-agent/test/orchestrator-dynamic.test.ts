// oxlint-disable-next-line effecttsgo/node-builtin-import -- the test writes a condition marker file
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import { harness } from "./orchestrator-harness.ts";

const { reviews, setup, taskStatus, waitFor } = harness;

const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

it("reruns a running task after a dependency added mid-run completes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, { title: "a", prompt: "do a" });
      const c = yield* create(orchestrator, { title: "c", prompt: "do c" });
      yield* Effect.promise(() => orchestrator.addDependency(a.id, c.id));
      expect(taskStatus(orchestrator, a.id)).toBe("running");

      workers[0]?.complete("a first pass");
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "waiting");
      expect(
        orchestrator.snapshot.tasks.find((task) => task.id === a.id)?.waitingReason?.kind,
      ).toBe("dependencies");

      workers[1]?.complete("c done");
      yield* waitFor(() => workers.length === 3);
      workers[2]?.complete("c reviewed");
      yield* waitFor(() => workers.length === 4);
      expect(workers[3]?.prompts[0]).toContain("do a");
      expect(workers[3]?.prompts[0]).toContain("c reviewed");
    }),
  ));

it("runs waiting tasks in priority order", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, { title: "a", prompt: "do a" });
      yield* create(orchestrator, { title: "b", prompt: "do b", priority: 0 });
      yield* create(orchestrator, { title: "c", prompt: "do c", priority: 10 });
      expect(workers).toHaveLength(1);

      workers[0]?.complete("a done");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("a reviewed");
      yield* waitFor(() => workers.length === 3);
      expect(taskStatus(orchestrator, a.id)).toBe("completed");
      expect(workers[2]?.prompts[0]).toContain("do c");
    }),
  ));

it("changes the concurrency limit while tasks wait", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      yield* create(orchestrator, { title: "a", prompt: "do a" });
      yield* create(orchestrator, { title: "b", prompt: "do b" });
      yield* create(orchestrator, { title: "c", prompt: "do c" });
      expect(workers).toHaveLength(1);

      yield* Effect.promise(() => orchestrator.setMaxConcurrentSessions(3));
      yield* waitFor(() => workers.length === 3);
      expect(orchestrator.snapshot.maxConcurrentSessions).toBe(3);
    }),
  ));

it("waits for an external command to exit 0 before starting a task", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const dir = `${tmpdir()}/msa-orchestrator-${process.pid}`;
      mkdirSync(dir, { recursive: true });
      const { orchestrator, workers } = setup({ pollIntervalMs: 5 });
      try {
        const task = yield* create(orchestrator, {
          title: "merge",
          prompt: "after the merge",
          cwd: dir,
          condition: `test -f ${dir}/ready`,
        });
        expect(task.status).toBe("waiting");
        yield* Effect.sleep(40);
        expect(workers).toHaveLength(0);

        writeFileSync(`${dir}/ready`, "");
        yield* waitFor(() => workers.length === 1);
        expect(workers[0]?.prompts[0]).toContain("after the merge");
      } finally {
        yield* Effect.promise(() => orchestrator.dispose());
        rmSync(dir, { recursive: true, force: true });
      }
    }),
  ));

it("closes each round's review without waiting for another round's tasks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      yield* create(orchestrator, { title: "a", prompt: "do a", round: "one" });
      const b = yield* create(orchestrator, { title: "b", prompt: "do b", round: "two" });
      workers.find((worker) => worker.prompts[0]?.includes("do a"))?.complete("a done");
      yield* waitFor(() =>
        workers.some(
          (worker) =>
            worker.prompts[0]?.includes("reviewing work another session") === true &&
            worker.prompts[0]?.includes("a done") === true,
        ),
      );
      workers
        .find(
          (worker) =>
            worker.prompts[0]?.includes("reviewing work another session") === true &&
            worker.prompts[0]?.includes("a done") === true,
        )
        ?.complete("a reviewed");
      yield* waitFor(() =>
        reviews(orchestrator).some((task) => task.round === "one" && task.status === "running"),
      );
      expect(taskStatus(orchestrator, b.id)).toBe("running");
    }),
  ));

it("changes a running task's model and a waiting task's priority", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, { title: "a", prompt: "do a" });
      const b = yield* create(orchestrator, {
        title: "b",
        prompt: "do b",
        dependsOn: [a.id],
      });
      yield* Effect.promise(() => orchestrator.setModel(a.id, "sub/fable", "high"));
      expect(workers[0]?.model.id).toBe("fable");
      expect(workers[0]?.thinkingLevel).toBe("high");
      const prioritized = yield* Effect.promise(() => orchestrator.setPriority(b.id, 7));
      expect(prioritized.priority).toBe(7);
    }),
  ));

it("stops a task and leaves its dependents waiting", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const a = yield* create(orchestrator, { title: "a", prompt: "do a" });
      const b = yield* create(orchestrator, {
        title: "b",
        prompt: "do b",
        dependsOn: [a.id],
      });
      const stopped = yield* Effect.promise(() => orchestrator.stop(a.id));
      expect(stopped.status).toBe("stopped");
      expect(taskStatus(orchestrator, b.id)).toBe("waiting");
    }),
  ));
