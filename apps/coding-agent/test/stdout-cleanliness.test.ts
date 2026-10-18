import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  awaited,
  runTest,
  writeTextFile,
  makeDirectory,
  joinPath,
  resolvePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import { envSnapshot } from "../src/core/process-env.ts";
import { allowNetwork } from "./test-network-env.ts";

const cliPath = resolvePath(__dirname, "../src/cli.ts");

const sourceResolverUrl = pathToFileURL(
  resolvePath(__dirname, "../src/experimental/source-resolver.ts"),
).href;

const tempDirs: string[] = [];

beforeEach(() => {
  allowNetwork();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = mkdtempSync(joinPath(tmpdir(), "msa-stdout-clean-"));
  tempDirs.push(dir);
  return dir;
}

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return runTest(
    Effect.gen(function* () {
      const tempRoot = createTempDir();
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
        JSON.stringify(
          {
            packages: ["npm:fake-package"],
            npmCommand: [process.execPath, fakeNpmPath],
          },
          null,
          2,
        ),
      );

      return yield* awaited(
        yield* awaited(
          new Promise<{ stdout: string; stderr: string; code: number | null }>(
            (resolvePromise, reject) => {
              const child = spawn(
                process.execPath,
                ["--import", sourceResolverUrl, cliPath, ...args],
                {
                  cwd: projectDir,
                  env: {
                    ...envSnapshot(),
                    [ENV_AGENT_DIR]: agentDir,
                  },
                  stdio: ["ignore", "pipe", "pipe"],
                },
              );

              let stdout = "";
              let stderr = "";
              child.stdout.on("data", (chunk) => {
                stdout += chunk.toString();
              });
              child.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
              });
              child.on("error", reject);
              child.on("close", (code) => {
                resolvePromise({ stdout, stderr, code });
              });
            },
          ),
        ),
      );
    }),
  );
}

describe("stdout cleanliness in non-interactive modes", () => {
  it("prints plain --help to stdout when stdout is redirected", () =>
    runTest(
      Effect.gen(function* () {
        const result = yield* awaited(runCli(["--help"]));

        expect(result.code).toBe(0);
        expect(result.stdout).toContain("Usage:");
        expect(result.stderr).not.toContain("Usage:");
        expect(result.stderr).not.toContain("changed 1 package in 471ms");
        expect(result.stderr).not.toContain("found 0 vulnerabilities");
      }),
    ));

  it("keeps stdout empty for --mode json --help while routing trusted startup chatter to stderr", () =>
    runTest(
      Effect.gen(function* () {
        const result = yield* awaited(runCli(["--mode", "json", "--help", "--approve"]));

        expect(result.code).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("changed 1 package in 471ms");
        expect(result.stderr).toContain("found 0 vulnerabilities");
        expect(result.stderr).toContain("Usage:");
      }),
    ));
});
