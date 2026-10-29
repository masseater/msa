import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Schema } from "effect";
import { expect, it } from "vite-plus/test";

import testProcess from "./test-process.ts";

const { captureProcess, processRunnerLayer } = testProcess;

const repoRoot = `${import.meta.dirname}/../..`;
const rule = `${repoRoot}/tools/rules/no-fork-in-run-sync.yml`;

const Matches = Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String })));

const forkedUnderRunSync: readonly string[] = [
  "Effect.runSync(FiberSet.run(this.launched, effect));",
  "const fiber = Effect.runSync(FiberSet.run(set, Effect.forever(tick)));",
  "Effect.runSync(FiberMap.run(map, key, effect));",
  "Effect.runSync(FiberHandle.run(handle, effect));",
  "Effect.runSync(Effect.forkDetach(loop));",
  "Effect.runSyncExit(Effect.gen(function* () { yield* Effect.forkIn(loop, scope); }));",
];

const notForked: readonly string[] = [
  "FiberSet.addUnsafe(set, Effect.runFork(effect));",
  "Effect.runSync(FiberSet.make<void>().pipe(Scope.provide(scope)));",
  "Effect.runSync(Effect.sync(() => 1));",
  "Effect.runPromise(FiberSet.run(set, effect));",
];

const probeRuntime = ManagedRuntime.make(
  processRunnerLayer.pipe(Layer.provideMerge(NodeServices.layer)),
);

const reportedCases = (sources: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "msa-fork-in-run-sync-rule-" });
      const dir = `${root}/libs/example/src`;
      yield* fs.makeDirectory(dir, { recursive: true });
      for (const [index, source] of sources.entries())
        yield* fs.writeFileString(`${dir}/case-${index}.ts`, `${source}\n`);
      const { stdout } = yield* captureProcess({
        args: ["scan", "--rule", rule, "--json=compact", "libs"],
        command: `${repoRoot}/node_modules/.bin/ast-grep`,
        cwd: root,
      });
      const matches = yield* Schema.decodeEffect(Matches)(stdout);
      const reported = new Set(matches.map((match) => match.file));
      return sources.filter((_, index) => reported.has(`libs/example/src/case-${index}.ts`));
    }),
  );

const expectReported = (sources: readonly string[], expected: readonly string[]) => () =>
  probeRuntime.runPromise(
    Effect.gen(function* () {
      expect(yield* reportedCases(sources)).toEqual(expected);
    }),
  );

it(
  "reports fibers forked inside Effect.runSync, which keep its sync scheduler",
  expectReported(forkedUnderRunSync, forkedUnderRunSync),
);

it(
  "passes fibers started with Effect.runFork and runSync calls that fork nothing",
  expectReported(notForked, []),
);
