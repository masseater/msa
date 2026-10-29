import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Schema } from "effect";
import { expect, it } from "vite-plus/test";

import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;

const repoRoot = `${import.meta.dirname}/../..`;
const rule = `${repoRoot}/tools/rules/no-untracked-orchestrator-launch.yml`;
const orchestratorDir = "apps/coding-agent/src/core/orchestrator";

const Matches = Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String })));

const untracked: readonly string[] = [
  "void worker.run.prompting.prompt(prompt).then(next, fail);",
  "const settle = (error: unknown) => void runtime.settle(id, run, worker, error);",
  "void Effect.runPromise(threadRuns.whileCurrent(thread, merging)).then(next);",
  "Effect.runPromise(effect).then(next);",
  "Effect.runPromise(effect);",
  "function start() { return Effect.runFork(Effect.forever(loop)); }",
  "FiberSet.addUnsafe(set, fiber); Effect.runFork(effect);",
  "Effect.runCallback(effect);",
  "const fork = Effect.gen(function* () { yield* Effect.forkDetach(loop); });",
  "const fork = Effect.gen(function* () { yield* Effect.forkChild(loop); });",
  "runtime.exclusive(effect).catch(() => undefined);",
  "worker.integrations.prWatch.close().finally(done);",
];

const tracked: readonly string[] = [
  "runtime.launch(Effect.promise(() => worker.run.prompting.prompt(prompt).then(next, fail)));",
  "function read() { return Effect.runPromise(effect); }",
  "async function read() { await Effect.runPromise(effect).then(next); }",
  "const read = () => runtime.exclusive(effect).catch(() => undefined);",
  "const run = this.queue.then(() => Effect.runPromise(effect));",
  "FiberSet.addUnsafe(this.launched, Effect.runFork(effect));",
];

const probeRuntime = ManagedRuntime.make(
  processRunnerLayer.pipe(Layer.provideMerge(NodeServices.layer)),
);

const reportedCases = (sources: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "msa-launch-rule-" });
      const dir = `${root}/${orchestratorDir}`;
      yield* fs.makeDirectory(dir, { recursive: true });
      for (const [index, source] of sources.entries())
        yield* fs.writeFileString(`${dir}/case-${index}.ts`, `${source}\n`);
      const { stdout } = yield* captureProcess({
        args: ["scan", "--rule", rule, "--json=compact", "apps"],
        command: `${repoRoot}/node_modules/.bin/ast-grep`,
        cwd: root,
      });
      const matches = yield* Schema.decodeEffect(Matches)(stdout);
      const reported = new Set(matches.map((match) => match.file));
      return sources.filter((_, index) => reported.has(`${orchestratorDir}/case-${index}.ts`));
    }),
  );

const expectReported = (sources: readonly string[], expected: readonly string[]) => () =>
  probeRuntime.runPromise(
    Effect.gen(function* () {
      expect(yield* reportedCases(sources)).toEqual(expected);
    }),
  );

it(
  "reports work the orchestrator starts without letting dispose wait for it",
  expectReported(untracked, untracked),
);

it(
  "passes work started through runtime.launch and promises that are returned or awaited",
  expectReported(tracked, []),
);
