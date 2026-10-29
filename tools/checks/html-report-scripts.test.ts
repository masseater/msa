import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime } from "effect";
import { expect, it } from "vite-plus/test";

import testProcess from "./test-process.ts";

const { captureProcess, processRunnerLayer } = testProcess;

const repoRoot = `${import.meta.dirname}/../..`;
const fixture = `${repoRoot}/apps/coding-agent/test/fixtures/before-compaction.jsonl`;

const runtime = ManagedRuntime.make(
  processRunnerLayer.pipe(Layer.provideMerge(NodeServices.layer)),
);

const writesReport = (script: string, scopeArgs: readonly string[]) => () =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "msa-html-report-" });
        yield* fs.makeDirectory(`${root}/sessions`);
        yield* fs.copyFile(fixture, `${root}/sessions/session.jsonl`);
        const output = `${root}/report.html`;
        const { exitCode, stderr, stdout } = yield* captureProcess({
          args: [
            `${repoRoot}/scripts/${script}`,
            "--sessions-dir",
            `${root}/sessions`,
            ...scopeArgs,
            "--output",
            output,
          ],
          command: process.execPath,
          cwd: root,
        });
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(stdout.trim()).toBe(`Wrote ${output}`);
        const html = yield* fs.readFileString(output);
        expect(html).toContain(
          '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'',
        );
      }),
    ),
  );

it(
  "read-tool-stats writes its HTML report to --output instead of stdout",
  writesReport("read-tool-stats.ts", ["--all-sessions"]),
);

it(
  "session-context-stats writes its HTML report to --output instead of stdout",
  writesReport("session-context-stats.ts", ["--all-cwds"]),
);
