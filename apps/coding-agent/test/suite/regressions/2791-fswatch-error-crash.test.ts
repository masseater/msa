import * as NodeServices from "@effect/platform-node/NodeServices";
import { fromJsonText, joinPath, toJsonText } from "@msa/testing";
import { Cause, Effect, Exit, FileSystem, ManagedRuntime, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { envSnapshot } from "../../../src/core/process-env.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let tempRoot: string;

const processShouldSurviveAnErrorEvent = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const themeModulePath = joinPath(
        __dirname,
        "../../../src/modes/interactive/theme/theme.ts",
      ).replace(/\\/gu, "/");
      const agentDir = joinPath(tempRoot, "agent").replace(/\\/gu, "/");

      const scriptPath = joinPath(tempRoot, "test-watcher-error.mts");
      yield* fs.writeFileString(
        scriptPath,
        `
import { setTheme, stopThemeWatcher } from "${themeModulePath}";
process.env.MSA_CODING_AGENT_DIR = "${agentDir}";

setTheme("custom-test", true);

// Find the FSWatcher among active handles
const handles = (process as any)._getActiveHandles();
const fsWatcher = handles.find((h: any) => h.constructor?.name === "FSWatcher");

if (!fsWatcher) {
	process.stderr.write("no FSWatcher found among active handles\\n");
	process.exit(2);
}

const errorListenerCount = fsWatcher.listenerCount("error");
if (errorListenerCount === 0) {
	process.stderr.write("BUG: FSWatcher has no error handler (issue #2791)\\n");
}

// Emitting 'error' on an EventEmitter with no error listener throws.
// This simulates an async OS error (e.g. ReadDirectoryChangesW invalidation).
try {
	fsWatcher.emit("error", new Error("simulated OS watcher failure"));
} catch {
	process.stderr.write("error event was unhandled and threw\\n");
	process.exit(1);
}

stopThemeWatcher();
process.exit(0);
`,
      );

      let stderr: string;
      let exitCode: number;
      const childExit = yield* Effect.exit(
        Effect.gen(function* () {
          const handle = yield* ChildProcess.make(process.execPath, [scriptPath], {
            env: { ...envSnapshot(), MSA_CODING_AGENT_DIR: agentDir },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stderrText, code] = yield* Effect.all(
            [handle.stderr.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
            { concurrency: 2 },
          );
          return { code: code ?? 1, stderr: stderrText };
        }).pipe(Effect.scoped),
      );
      if (Exit.isFailure(childExit)) {
        const failure = Cause.squash(childExit.cause) as { status?: number; stderr?: string };
        stderr = failure.stderr ?? "";
        exitCode = failure.status ?? 1;
      } else {
        stderr = childExit.value.stderr;
        exitCode = childExit.value.code;
      }

      expect(exitCode, `Child crashed (exit ${exitCode}). stderr: ${stderr.trim()}`).toBe(0);
    }),
  );

describe("issue #2791 fs.watch error event crashes process", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempRoot = yield* fs.makeTempDirectory({ prefix: "msa-2791-" });
        const agentDir = joinPath(tempRoot, "agent");
        const themesDir = joinPath(agentDir, "themes");
        yield* fs.makeDirectory(themesDir, { recursive: true });

        const darkThemePath = joinPath(__dirname, "../../../src/modes/interactive/theme/dark.json");
        const darkTheme = (yield* fromJsonText(yield* fs.readFileString(darkThemePath))) as {
          name: string;
        };
        darkTheme.name = "custom-test";
        yield* fs.writeFileString(
          joinPath(themesDir, "custom-test.json"),
          yield* toJsonText(darkTheme),
        );
      }),
    ),
  );
  afterEach(() => runtime.runPromise(fs.remove(tempRoot, { recursive: true, force: true })));
  it(
    "process should survive an error event on the theme FSWatcher",
    processShouldSurviveAnErrorEvent,
  );
});
