import testing from "@msa/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { executeBashWithOperations } from "../src/core/bash-executor.ts";
import { createBashTool, createLocalBashOperations } from "../src/core/tools/bash.ts";

const {
  abortController,
  awaited,
  joinPath,
  makeTempDir,
  pathExists,
  provideNode,
  readTextFile,
  removePath,
  runTest,
} = testing;

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

const cleanupDetachedChild = Effect.fn("cleanupDetachedChild")(function* (pidFile: string) {
  if (!(yield* pathExists(pidFile))) return;
  const pid = Number.parseInt((yield* readTextFile(pidFile)).trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return;
  yield* provideNode(
    Effect.scoped(
      Effect.flatMap(
        ChildProcess.make("taskkill", ["/F", "/T", "/PID", String(pid)], {
          stderr: "ignore",
          stdin: "ignore",
          stdout: "ignore",
        }),
        (handle) => handle.exitCode,
      ),
    ),
  ).pipe(Effect.ignore);
});

const withTimeout = <T>(promise: Promise<T>, onTimeout: () => void) =>
  awaited(promise).pipe(
    Effect.timeoutOrElse({
      duration: "3 seconds",
      orElse: () =>
        Effect.sync(onTimeout).pipe(
          Effect.andThen(Effect.die(new Error("Timed out after 3000ms"))),
        ),
    }),
  );

function getTextOutput(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (
    result.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}

let testDir: string;

const executebashResolvesAfterTheShellExitsEven = () =>
  runTest(
    Effect.gen(function* () {
      const pidFile = joinPath(testDir, "executor-grandchild.pid");
      const command = createInheritedStdioCommand(pidFile);
      const controller = abortController();

      try {
        const result = yield* withTimeout(
          executeBashWithOperations(command, process.cwd(), createLocalBashOperations(), {
            signal: controller.signal,
          }),
          () => controller.abort(),
        );

        expect(result.output).toContain("child-exiting");
        expect(result.exitCode).toBe(0);
        expect(result.cancelled).toBe(false);
      } finally {
        controller.abort();
        yield* cleanupDetachedChild(pidFile);
      }
    }),
  );

const bashToolResolvesAfterTheShellExits = () =>
  runTest(
    Effect.gen(function* () {
      const pidFile = joinPath(testDir, "tool-grandchild.pid");
      const command = createInheritedStdioCommand(pidFile);
      const controller = abortController();
      const bashTool = createBashTool(testDir);

      try {
        const result = yield* withTimeout(
          bashTool.execute("test-call", { command }, controller.signal),
          () => controller.abort(),
        );

        expect(getTextOutput(result)).toContain("child-exiting");
      } finally {
        controller.abort();
        yield* cleanupDetachedChild(pidFile);
      }
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      testDir = yield* makeTempDir("coding-agent-bash-close-test-");
    }),
  );

describe.skipIf(process.platform !== "win32")("Windows child-process close handling", () => {
  beforeEach(beforeEachHook);

  afterEach(() => runTest(removePath(testDir)));

  it(
    "executeBash resolves after the shell exits even if inherited stdio handles stay open",
    executebashResolvesAfterTheShellExitsEven,
  );

  it(
    "bash tool resolves after the shell exits even if inherited stdio handles stay open",
    bashToolResolvesAfterTheShellExits,
  );
});
