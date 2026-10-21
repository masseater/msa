import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import bash from "../src/core/tools/bash.ts";
import find from "../src/core/tools/find.ts";
import ls from "../src/core/tools/ls.ts";
import tools7Support from "./tools-7-support.ts";

const { createFindToolDefinition } = find;
const { createLsToolDefinition } = ls;
const { createBashToolDefinition } = bash;

const { getTextOutput } = tools7Support;

const { awaited, joinPath, makeTempDir, removePath, runTest, writeTextFile } = testing;

function fakeCtx(cwd: string): extensionsTypesTypes.ExtensionToolContext {
  return { cwd } as extensionsTypesTypes.ExtensionToolContext;
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

const findUsesCtxCwdWhenProvided = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(testDir, "ctx-cwd-find.txt"), "find me");
      const tool = createFindToolDefinition("/");
      const result = yield* awaited(
        tool.execute(
          "test-find-ctx-cwd",
          { pattern: "ctx-cwd-find.txt" },
          undefined,
          undefined,
          fakeCtx(testDir),
        ),
      );
      const output = getTextOutput(result);
      expect(output).toContain("ctx-cwd-find.txt");
    }),
  );

const lsUsesCtxCwdWhenProvided = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(testDir, "ctx-cwd-ls.txt"), "list me");
      const tool = createLsToolDefinition("/");
      const result = yield* awaited(
        tool.execute("test-ls-ctx-cwd", {}, undefined, undefined, fakeCtx(testDir)),
      );
      const output = getTextOutput(result);
      expect(output).toContain("ctx-cwd-ls.txt");
    }),
  );

const bashUsesCtxCwdWhenProvided = () =>
  runTest(
    Effect.gen(function* () {
      const tool = createBashToolDefinition("/", { exposeSessionEnvironment: false });
      const result = yield* awaited(
        tool.execute(
          "test-bash-ctx-cwd",
          { command: "pwd" },
          undefined,
          undefined,
          fakeCtx(testDir),
        ),
      );
      const output = getTextOutput(result);
      expect(output).toContain(testDir);
    }),
  );

describe("tool cwd resolution", () => {
  it("find uses ctx.cwd when provided", findUsesCtxCwdWhenProvided);

  it("ls uses ctx.cwd when provided", lsUsesCtxCwdWhenProvided);

  it("bash uses ctx.cwd when provided", bashUsesCtxCwdWhenProvided);
});
