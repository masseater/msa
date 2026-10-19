import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  awaited,
  runTest,
  currentTimeMillis,
  abortController,
  randomSuffixSync,
  joinPath,
  makeDirectory,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { executeBashWithOperations } from "../src/core/bash-executor.ts";
import { createBashTool, createLocalBashOperations } from "../src/core/tools/bash.ts";

function toBashSingleQuotedArg(value: string): string {
  return `'${value.replace(/\\/gu, "/").replace(/'/gu, `'"'"'`)}'`;
}

function createInheritedStdioCommand(pidFile: string): string {
  const pidFileArg = toBashSingleQuotedArg(pidFile);
  return (
    'node -e "' +
    "const fs=require('fs');" +
    "const {spawn}=require('child_process');" +
    "const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true});" +
    "fs.writeFileSync(process.argv[1], String(child.pid));" +
    "child.unref();" +
    "console.log('child-exiting');" +
    '" ' +
    pidFileArg
  );
}

function cleanupDetachedChild(pidFile: string): void {
  if (!existsSync(pidFile)) {
    return;
  }

  const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  if (Number.isFinite(pid) && pid > 0) {
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
    } catch {}
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return runTest(
    awaited(
      new Promise<T>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          onTimeout();
          reject(new Error(`Timed out after ${ms}ms`));
        }, ms);

        promise.then(
          (value) => {
            clearTimeout(timeoutId);
            resolve(value);
          },
          (error: unknown) => {
            clearTimeout(timeoutId);
            reject(error);
          },
        );
      }),
    ),
  );
}

function getTextOutput(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (
    result.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}

describe.skipIf(process.platform !== "win32")("Windows child-process close handling", () => {
  let testDir: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        testDir = joinPath(
          tmpdir(),
          `coding-agent-bash-close-test-${currentTimeMillis()}-${randomSuffixSync()}`,
        );
        yield* makeDirectory(testDir);
      }),
    ),
  );

  afterEach(() => runTest(removePath(testDir)));

  it("executeBash resolves after the shell exits even if inherited stdio handles stay open", () =>
    runTest(
      Effect.gen(function* () {
        const pidFile = joinPath(testDir, "executor-grandchild.pid");
        const command = createInheritedStdioCommand(pidFile);
        const controller = abortController();

        try {
          const result = yield* awaited(
            withTimeout(
              executeBashWithOperations(command, process.cwd(), createLocalBashOperations(), {
                signal: controller.signal,
              }),
              3000,
              () => {
                controller.abort();
              },
            ),
          );

          expect(result.output).toContain("child-exiting");
          expect(result.exitCode).toBe(0);
          expect(result.cancelled).toBe(false);
        } finally {
          controller.abort();
          cleanupDetachedChild(pidFile);
        }
      }),
    ));

  it("bash tool resolves after the shell exits even if inherited stdio handles stay open", () =>
    runTest(
      Effect.gen(function* () {
        const pidFile = joinPath(testDir, "tool-grandchild.pid");
        const command = createInheritedStdioCommand(pidFile);
        const controller = abortController();
        const bashTool = createBashTool(testDir);

        try {
          const result = yield* awaited(
            withTimeout(bashTool.execute("test-call", { command }, controller.signal), 3000, () => {
              controller.abort();
            }),
          );

          expect(getTextOutput(result)).toContain("child-exiting");
        } finally {
          controller.abort();
          cleanupDetachedChild(pidFile);
        }
      }),
    ));
});
