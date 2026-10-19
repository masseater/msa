import {
  awaited,
  runTest,
  readTextFile,
  writeTextFile,
  pathExists,
  joinPath,
  pollUntil,
  makeTempDir,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { executeBashWithOperations } from "../src/core/bash-executor.ts";
import { envSnapshot } from "../src/core/process-env.ts";
import {
  type BashOperations,
  createBashTool,
  createLocalBashOperations,
} from "../src/core/tools/bash.ts";
import { createGrepTool } from "../src/index.ts";

const grepTool = createGrepTool(process.cwd());

function getTextOutput(result: any): string {
  return (
    result.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || ""
  );
}

let testDir = "";

beforeEach(() =>
  runTest(makeTempDir("coding-agent-tools-")).then((dir) => {
    testDir = dir;
    return dir;
  }),
);

afterEach(() => {
  vi.restoreAllMocks();
  return runTest(removePath(testDir));
});

describe("bash tool", () => {
  it("should work without command prefix", () =>
    runTest(
      Effect.gen(function* () {
        const bashWithoutPrefix = createBashTool(testDir, {});

        const result = yield* awaited(
          bashWithoutPrefix.execute("test-prefix-3", {
            command: "echo no-prefix",
          }),
        );
        expect(getTextOutput(result).trim()).toBe("no-prefix");
      }),
    ));

  it("should coalesce streaming updates for chatty output", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const operations: BashOperations = {
          exec: (_command, _cwd, { onData }) =>
            effectRunPromise(
              Effect.gen(function* () {
                for (let i = 0; i < 5000; i++) {
                  onData(Buffer.from(`line ${i}\n`, "utf-8"));
                }
                return yield* awaited({ exitCode: 0 });
              }),
            ),
        };
        const updates: Array<{
          content: Array<{ type: string; text?: string }>;
          details?: unknown;
        }> = [];
        const bash = createBashTool(testDir, { operations });

        const result = yield* awaited(
          bash.execute("test-call-chatty-updates", { command: "chatty" }, undefined, (update) =>
            updates.push(update),
          ),
        );

        expect(updates.length).toBeLessThan(25);
        expect(getTextOutput(result)).toContain("line 4999");
      }),
    ));

  it("should not count a trailing newline as an extra truncated bash output line", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const operations: BashOperations = {
          exec: (_command, _cwd, { onData }) =>
            effectRunPromise(
              Effect.gen(function* () {
                for (let i = 1; i <= 4000; i++) {
                  onData(Buffer.from(`line-${String(i).padStart(4, "0")}\n`, "utf-8"));
                }
                return yield* awaited({ exitCode: 0 });
              }),
            ),
        };
        const bash = createBashTool(testDir, { operations });

        const result = yield* awaited(
          bash.execute("test-call-trailing-newline-line-count", {
            command: "many-lines",
          }),
        );
        const output = getTextOutput(result);

        expect(result.details?.truncation?.totalLines).toBe(4000);
        expect(result.details?.truncation?.outputLines).toBe(2000);
        expect(output).toContain("line-2001");
        expect(output).toContain("line-4000");
        expect(output).toMatch(/\[Showing lines 2001-4000 of 4000\. Full output: /u);
        expect(output).not.toContain("4001");
      }),
    ));

  it("should decode UTF-8 characters split across output chunks", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const euro = Buffer.from("€\n", "utf-8");
        const operations: BashOperations = {
          exec: (_command, _cwd, { onData }) =>
            effectRunPromise(
              Effect.gen(function* () {
                onData(euro.subarray(0, 1));
                onData(euro.subarray(1));
                return yield* awaited({ exitCode: 0 });
              }),
            ),
        };
        const bash = createBashTool(testDir, { operations });

        const result = yield* awaited(
          bash.execute("test-call-split-utf8", { command: "split-utf8" }),
        );

        expect(getTextOutput(result).trim()).toBe("€");
      }),
    ));

  it("should expose local bash operations for extension reuse", () =>
    runTest(
      Effect.gen(function* () {
        const ops = createLocalBashOperations();
        const chunks: Buffer[] = [];

        const result = yield* awaited(
          ops.exec("echo $TEST_LOCAL_BASH_OPS", testDir, {
            onData: (data) => chunks.push(data),
            env: { ...envSnapshot(), TEST_LOCAL_BASH_OPS: "from-local-ops" },
          }),
        );

        expect(result.exitCode).toBe(0);
        expect(Buffer.concat(chunks).toString("utf-8").trim()).toBe("from-local-ops");
      }),
    ));

  it("should preserve executeBash sanitization when using local bash operations", () =>
    runTest(
      Effect.gen(function* () {
        const result = yield* awaited(
          executeBashWithOperations(
            "printf '\\033[31mred\\033[0m\\r\\n'",
            process.cwd(),
            createLocalBashOperations(),
          ),
        );

        expect(result.exitCode).toBe(0);
        expect(result.output).toBe("red\n");
      }),
    ));

  it("should persist full output when truncation happens by line count only", () =>
    runTest(
      Effect.gen(function* () {
        const bash = createBashTool(testDir);
        const result = yield* awaited(
          bash.execute("test-call-line-truncation", { command: "seq 3000" }),
        );
        const output = getTextOutput(result);
        const fullOutputPath = result.details?.fullOutputPath;

        expect(result.details?.truncation?.truncated).toBe(true);
        expect(result.details?.truncation?.truncatedBy).toBe("lines");
        expect(fullOutputPath).toBeDefined();
        expect(output).toMatch(/\[Showing lines \d+-\d+ of \d+\. Full output: /u);
        expect(output).not.toContain("Full output: undefined");

        if (fullOutputPath === undefined) throw new Error("expected a full output path");
        yield* pollUntil(pathExists(fullOutputPath), 20, 10);

        expect(yield* pathExists(fullOutputPath)).toBe(true);
        const fullOutput = yield* readTextFile(fullOutputPath!);
        expect(fullOutput).toContain("1\n2\n3");
        expect(fullOutput).toContain("2998\n2999\n3000");
      }),
    ));

  it("executeBash should persist full output when truncation happens by line count only", () =>
    runTest(
      Effect.gen(function* () {
        const result = yield* awaited(
          executeBashWithOperations("seq 3000", process.cwd(), createLocalBashOperations()),
        );
        const fullOutputPath = result.fullOutputPath;

        expect(result.truncated).toBe(true);
        expect(fullOutputPath).toBeDefined();

        if (fullOutputPath === undefined) throw new Error("expected a full output path");
        yield* pollUntil(pathExists(fullOutputPath), 20, 10);

        expect(yield* pathExists(fullOutputPath)).toBe(true);
        const fullOutput = yield* readTextFile(fullOutputPath!);
        expect(fullOutput).toContain("1\n2\n3");
        expect(fullOutput).toContain("2998\n2999\n3000");
      }),
    ));
});

describe("grep tool", () => {
  it("should include filename when searching a single file", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "example.txt");
        yield* writeTextFile(testFile, "first line\nmatch line\nlast line");

        const result = yield* awaited(
          grepTool.execute("test-call-11", {
            pattern: "match",
            path: testFile,
          }),
        );

        const output = getTextOutput(result);
        expect(output).toContain("example.txt:2: match line");
      }),
    ));
});
