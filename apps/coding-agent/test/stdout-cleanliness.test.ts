import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import cliProcess from "./cli-process.ts";
import testNetworkEnv from "./test-network-env.ts";

const { allowNetwork } = testNetworkEnv;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removeDirs,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const { runCli: runCliProcess } = cliProcess;

const tempDirs: string[] = [];

beforeEach(() => {
  allowNetwork();
});

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const prepareProject = Effect.fn("prepareProject")(function* () {
  const tempRoot = yield* makeTempDir("msa-stdout-clean-");
  tempDirs.push(tempRoot);
  const agentDir = joinPath(tempRoot, "agent");
  const projectDir = joinPath(tempRoot, "project");
  const projectConfigDir = joinPath(projectDir, ".msa");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(projectConfigDir);
  const fakeNpmPath = joinPath(tempRoot, "fake-npm.mjs");
  yield* writeTextFile(
    fakeNpmPath,
    [
      'console.log("changed 1 package in 471ms");',
      'console.log("found 0 vulnerabilities");',
      "process.exit(0);",
    ].join("\n"),
  );
  yield* writeTextFile(
    joinPath(projectConfigDir, "settings.json"),
    yield* toJsonText({
      npmCommand: [process.execPath, fakeNpmPath],
      packages: ["npm:fake-package"],
    }),
  );
  return { agentDir, projectDir };
});

const runCli = (args: string[]) =>
  runTest(
    Effect.gen(function* () {
      const { agentDir, projectDir } = yield* prepareProject();
      return yield* awaited(runCliProcess(args, { agentDir, cwd: projectDir, offline: false }));
    }),
  );

const printsPlainHelpToStdoutWhenStdout = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(runCli(["--help"]));

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(result.stderr).not.toContain("Usage:");
      expect(result.stderr).not.toContain("changed 1 package in 471ms");
      expect(result.stderr).not.toContain("found 0 vulnerabilities");
    }),
  );

const keepsStdoutEmptyForModeJsonHelp = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(runCli(["--mode", "json", "--help", "--approve"]));

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("changed 1 package in 471ms");
      expect(result.stderr).toContain("found 0 vulnerabilities");
      expect(result.stderr).toContain("Usage:");
    }),
  );

describe("stdout cleanliness in non-interactive modes", () => {
  it("prints plain --help to stdout when stdout is redirected", printsPlainHelpToStdoutWhenStdout);

  it(
    "keeps stdout empty for --mode json --help while routing trusted startup chatter to stderr",
    keepsStdoutEmptyForModeJsonHelp,
  );
});
