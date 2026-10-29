import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Schema } from "effect";
import { expect, it } from "vite-plus/test";

import testProcess from "./test-process.ts";

const { captureProcess, processRunnerLayer } = testProcess;

const repoRoot = `${import.meta.dirname}/../..`;
const rule = `${repoRoot}/tools/rules/no-unawaited-test-cleanup.yml`;

const Matches = Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String })));

const discarding: readonly string[] = [
  "harnesses.forEach((h) => h.cleanup());",
  "void x.cleanup();",
  "p.then(() => x.cleanup());",
  "harnesses.map((h) => h.cleanup());",
  "harnesses.map(async (h) => { await h.cleanup(); });",
  "harnesses.forEach(async (h) => { await h.cleanup(); });",
  "setTimeout(() => x.cleanup(), 10);",
  "setTimeout(async () => { await x.cleanup(); }, 10);",
  "run(async () => { await x.cleanup(); });",
  "x.cleanup();",
  "cleanup();",
  "const closing = x.cleanup();",
  "async function f() { const closing = x.cleanup(); await other; }",
  "Promise.resolve(x?.cleanup()).finally(() => undefined);",
  "cleanups.push(harness.cleanup);",
];

const waiting: readonly string[] = [
  "afterEach(async () => { await x.cleanup(); });",
  "afterEach(() => x?.cleanup());",
  "async function f() { await x?.cleanup(); }",
  "function f() { return x.cleanup(); }",
  "afterEach(() => { const closing = x?.cleanup(); x = undefined; return closing; });",
  "async function f() { const closing = x.cleanup(); step(); await closing; }",
  'it("t", () => runTest(Effect.gen(function* () { try { a(); } finally { yield* awaited(x.cleanup()); } })));',
  'it.each([1])("t %s", () => runTest(Effect.gen(function* () { yield* awaited(cleanup()); })));',
  'describe("d", () => { afterEach(async () => { await cleanup(); }); });',
  "const close = async () => { await harness.cleanup(); };",
];

const probeRuntime = ManagedRuntime.make(
  processRunnerLayer.pipe(Layer.provideMerge(NodeServices.layer)),
);

const reportedCases = (sources: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "msa-cleanup-rule-" });
      const dir = `${root}/apps/coding-agent/test`;
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
      return sources.filter((_, index) => reported.has(`apps/coding-agent/test/case-${index}.ts`));
    }),
  );

const expectReported = (sources: readonly string[], expected: readonly string[]) => () =>
  probeRuntime.runPromise(
    Effect.gen(function* () {
      expect(yield* reportedCases(sources)).toEqual(expected);
    }),
  );

it(
  "reports every cleanup() whose result is not waited for",
  expectReported(discarding, discarding),
);

it(
  "passes cleanup() that is awaited, returned, or held and awaited later",
  expectReported(waiting, []),
);
