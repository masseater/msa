import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  awaited,
  runTest,
  currentTimeMillis,
  currentDate,
  joinPath,
  resolvePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import { envSnapshot } from "../src/core/process-env.ts";

const cliPath = resolvePath(__dirname, "../src/cli.ts");

const sourceResolverUrl = pathToFileURL(
  resolvePath(__dirname, "../src/experimental/source-resolver.ts"),
).href;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = mkdtempSync(joinPath(tmpdir(), "msa-startup-session-name-"));
  tempDirs.push(dir);
  return dir;
}

interface CliDirs {
  agentDir: string;
  projectDir: string;
  sessionFile: string;
}

interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

function createSessionFile(projectDir: string, sessionFile: string): void {
  const timestamp = currentDate().toISOString();
  writeFileSync(
    sessionFile,
    `${JSON.stringify({ type: "session" as const, version: 3, id: "existing-session", timestamp, cwd: projectDir })}\n${JSON.stringify(
      {
        type: "message" as const,
        id: "assistant-1",
        parentId: null,
        timestamp,
        message: {
          role: "assistant",
          content: [{ type: "text" as const, text: "hello" }],
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          timestamp: currentTimeMillis(),
        },
      },
    )}\n`,
  );
}

function readSessionInfoNames(sessionFile: string): string[] {
  return readFileSync(sessionFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type?: string; name?: string })
    .filter((entry) => entry.type === "session_info")
    .map((entry) => entry.name ?? "");
}

function runCli(args: string[], dirs: CliDirs): Promise<CliResult> {
  return runTest(
    Effect.gen(function* () {
      let stderr = "";
      const child = spawn(process.execPath, ["--import", sourceResolverUrl, cliPath, ...args], {
        cwd: dirs.projectDir,
        env: {
          ...envSnapshot(),
          [ENV_AGENT_DIR]: dirs.agentDir,
          MSA_OFFLINE: "1",
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      return yield* awaited(
        new Promise<CliResult>((resolvePromise, reject) => {
          const timeout = setTimeout(() => {
            child.kill("SIGKILL");
          }, 10_000);
          child.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          child.on("close", (code, signal) => {
            clearTimeout(timeout);
            resolvePromise({ code, signal, stderr });
          });
        }),
      );
    }),
  );
}

function setup(): CliDirs {
  const tempRoot = createTempDir();
  const dirs = {
    agentDir: joinPath(tempRoot, "agent"),
    projectDir: joinPath(tempRoot, "project"),
    sessionFile: joinPath(tempRoot, "session.jsonl"),
  };
  mkdirSync(dirs.agentDir, { recursive: true });
  mkdirSync(dirs.projectDir, { recursive: true });
  createSessionFile(dirs.projectDir, dirs.sessionFile);
  return dirs;
}

describe("startup session name", () => {
  it("sets --name on the selected session before runtime model validation", () =>
    runTest(
      Effect.gen(function* () {
        const dirs = setup();
        const result = yield* awaited(
          runCli(
            [
              "--session",
              dirs.sessionFile,
              "--name",
              "  CLI Named Session  ",
              "--model",
              "missing-model",
              "-p",
              "hi",
            ],
            dirs,
          ),
        );

        expect(result.code).toBe(1);
        expect(result.signal).toBeNull();
        expect(readSessionInfoNames(dirs.sessionFile)).toEqual(["CLI Named Session"]);
      }),
    ));
});
