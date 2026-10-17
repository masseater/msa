import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { pathOperations } from "../src/platform.ts";
import { makeTempDirectory, readFileString, removeRecursive, runCommand } from "./test-platform.ts";

const fixture = pathOperations.join(import.meta.dirname, "fixtures", "overwide-render-crash.ts");

const crashInChildProcess = (options: { tmpDir: string; logDirectory: string }) =>
  runCommand({
    file: process.execPath,
    args: [fixture, options.logDirectory],
    env: { TMPDIR: options.tmpDir, TMP: options.tmpDir, TEMP: options.tmpDir },
    timeout: 30000,
  });

describe("TUI crash dump", () => {
  it("writes the crash dump to the OS temp directory before the process dies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const crashDir = yield* makeTempDirectory("msa-tui-crash-");
        const crashLogPath = pathOperations.join(crashDir, "msa-tui-crash.log");
        yield* Effect.gen(function* () {
          const { exitCode, stderr } = yield* crashInChildProcess({
            tmpDir: crashDir,
            logDirectory: "",
          });
          assert.notStrictEqual(exitCode, 0);
          assert.match(stderr, /exceeds terminal width \(60 > 40\)/u);
          assert.ok(stderr.includes(crashLogPath), `stderr should reference ${crashLogPath}`);
          assert.match(yield* readFileString(crashLogPath), /Terminal width: 40/u);
        }).pipe(Effect.ensuring(removeRecursive(crashDir)));
      }),
    ));

  it("writes the crash dump to the configured log directory before the process dies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rootDir = yield* makeTempDirectory("msa-tui-crash-");
        const logDirectory = pathOperations.join(rootDir, "logs", "nested");
        const crashLogPath = pathOperations.join(logDirectory, "msa-tui-crash.log");
        yield* Effect.gen(function* () {
          const { exitCode, stderr } = yield* crashInChildProcess({
            tmpDir: rootDir,
            logDirectory,
          });
          assert.notStrictEqual(exitCode, 0);
          assert.ok(stderr.includes(crashLogPath), `stderr should reference ${crashLogPath}`);
          assert.match(yield* readFileString(crashLogPath), /Line 1 visible width: 60/u);
        }).pipe(Effect.ensuring(removeRecursive(rootDir)));
      }),
    ));
});
