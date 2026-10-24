import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import platform from "../src/platform.ts";
import testPlatform from "./test-platform.ts";

const { pathOperations } = platform;

const { makeTempDirectory, readFileString, removeRecursive, runCommand } = testPlatform;

const fixture = pathOperations.join(import.meta.dirname, "fixtures", "overwide-render-crash.ts");

const crashInChildProcess = (options: { tmpDir: string; logDirectory: string }) =>
  runCommand({
    args: ["--conditions=source", fixture, options.logDirectory],
    env: { TEMP: options.tmpDir, TMP: options.tmpDir, TMPDIR: options.tmpDir },
    file: process.execPath,
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
            logDirectory: "",
            tmpDir: crashDir,
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
            logDirectory,
            tmpDir: rootDir,
          });
          assert.notStrictEqual(exitCode, 0);
          assert.ok(stderr.includes(crashLogPath), `stderr should reference ${crashLogPath}`);
          assert.match(yield* readFileString(crashLogPath), /Line 1 visible width: 60/u);
        }).pipe(Effect.ensuring(removeRecursive(rootDir)));
      }),
    ));
});
