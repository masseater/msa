import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Schema } from "effect";
import { expect, it } from "vite-plus/test";

import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;

const repoRoot = `${import.meta.dirname}/../..`;
const rule = `${repoRoot}/tools/rules/no-counted-wait-loop.yml`;

const Matches = Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String })));

const counted: readonly string[] = [
  "function* f() { for (let i = 0; i < 50 && !done(); i++) yield* Effect.sleep(5); }",
  "function* f() { for (let i = 0; i < 20 && log.length === 0; i++) yield* tick; }",
  "function* f() { for (let i = 0; i < 100; i++) { if (yield* ok) return; yield* Effect.sleep(10); } }",
  "function* f() { for (let i = 0; i < 9; i++) { if (ready()) break; yield* advance(0); } }",
  "function* f() { let n = 0; while (!done() && n < 10) { n++; yield* Effect.sleep(5); } }",
  "async function f() { for (let i = 0; i < 10 && !done(); i++) await sleep(5); }",
];

const notWaits: readonly string[] = [
  "function* f() { yield* pollUntil(Effect.sync(done), 50, 5); }",
  "function* f() { for (let i = 0; i < 10; i++) yield* tick; }",
  "function* f() { for (;;) { if (yield* stop) break; yield* pause(1); } }",
  "function* f() { for (let r = 0; r < 10; r += 1) { const next = yield* read(); if (next.done) break; } }",
  "function* f() { for (const id of ids) yield* Effect.sleep(1); }",
];

const probeRuntime = ManagedRuntime.make(
  processRunnerLayer.pipe(Layer.provideMerge(NodeServices.layer)),
);

const reportedCases = (sources: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "msa-counted-wait-rule-" });
      const dir = `${root}/libs/example/test`;
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
      return sources.filter((_, index) => reported.has(`libs/example/test/case-${index}.ts`));
    }),
  );

const expectReported = (sources: readonly string[], expected: readonly string[]) => () =>
  probeRuntime.runPromise(
    Effect.gen(function* () {
      expect(yield* reportedCases(sources)).toEqual(expected);
    }),
  );

it("reports a test loop that counts its tries while it waits", expectReported(counted, counted));

it(
  "passes pollUntil, fixed-count loops, and loops that read until done",
  expectReported(notWaits, []),
);
