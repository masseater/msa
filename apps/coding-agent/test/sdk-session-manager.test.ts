import { tmpdir } from "node:os";

import { getModel } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect, FileSystem } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  removePath,
  runTest,
  provideNode,
  runTestSync,
} = testing;

const fileSystem = runTestSync(provideNode(FileSystem.FileSystem.useSync((service) => service)));

const realPath = (file: string): Effect.Effect<string> => Effect.orDie(fileSystem.realPath(file));

let tempDir: string;

let cwd: string;

let agentDir: string;

const usesAgentdirForTheDefaultPersistedSession = () =>
  runTest(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-sonnet-4-5");
      expect(model).toBeTruthy();

      const { session } = yield* awaited(
        createAgentSession({
          agentDir,
          cwd,
          model: model!,
        }),
      );

      const safePath = `--${cwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
      const expectedSessionDir = joinPath(agentDir, "sessions", safePath);
      const sessionDir = session.sessionManager.getSessionDir();
      const sessionFile = session.sessionManager.getSessionFile();

      expect(sessionDir).toBe(expectedSessionDir);
      expect(sessionFile?.startsWith(`${expectedSessionDir}/`)).toBe(true);

      session.dispose();
    }),
  );

const keepsAnExplicitSessionmanagerOverride = () =>
  runTest(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-sonnet-4-5");
      expect(model).toBeTruthy();

      const sessionManager = SessionManager.inMemory(cwd);
      const { session } = yield* awaited(
        createAgentSession({
          agentDir,
          cwd,
          model: model!,
          sessionManager,
        }),
      );

      expect(session.sessionManager).toBe(sessionManager);
      expect(session.sessionManager.isPersisted()).toBe(false);

      session.dispose();
    }),
  );

const derivesCwdFromAnExplicitSessionmanagerWhen = () =>
  runTest(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-sonnet-4-5");
      expect(model).toBeTruthy();

      const sessionCwd = joinPath(tempDir, "session-project");
      yield* makeDirectory(sessionCwd);
      const sessionManager = SessionManager.inMemory(sessionCwd);
      const { session } = yield* awaited(
        createAgentSession({
          agentDir,
          model: model!,
          sessionManager,
        }),
      );

      expect(session.sessionManager).toBe(sessionManager);
      expect(session.systemPrompt).toContain(`<cwd>\n${sessionCwd}\n</cwd>`);

      const bashTool = session.agent.state.tools.find((tool) => tool.name === "bash");
      expect(bashTool).toBeTruthy();
      const result = yield* awaited(bashTool!.execute("test", { command: "pwd" }));
      const output = result.content
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text)
        .join("");

      expect(yield* realPath(output.trim())).toBe(yield* realPath(sessionCwd));

      session.dispose();
    }),
  );

const exposesCurrentSessionStateToTheBuilt = () =>
  runTest(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-sonnet-4-5");
      expect(model).toBeTruthy();

      const { session } = yield* awaited(
        createAgentSession({
          agentDir,
          cwd,
          model: model!,
          thinkingLevel: "high",
        }),
      );
      expect(session.sessionFile).toBeTruthy();
      expect(session.systemPrompt).toContain(
        "You can inspect MSA_* environment variables for current model and session details.",
      );

      const bashTool = session.agent.state.tools.find((tool) => tool.name === "bash");
      expect(bashTool).toBeTruthy();
      const result = yield* awaited(
        bashTool!.execute("test", {
          command: `printf '%s\\n' "$MSA_SESSION_ID" "$MSA_SESSION_FILE" "$MSA_PROVIDER" "$MSA_MODEL" "$MSA_REASONING_LEVEL"`,
        }),
      );
      const output = result.content
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text)
        .join("");

      expect(output.trim().split("\n")).toEqual([
        session.sessionId,
        session.sessionFile,
        model!.provider,
        model!.id,
        session.thinkingLevel,
      ]);

      session.dispose();
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(
        tmpdir(),
        `msa-sdk-session-test-${currentTimeMillis()}-${randomSuffixSync()}`,
      );
      cwd = joinPath(tempDir, "project");
      agentDir = joinPath(tempDir, "agent");
      yield* makeDirectory(cwd);
      yield* makeDirectory(agentDir);
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
        yield* removePath(tempDir);
      }
    }),
  );

describe("createAgentSession session manager defaults", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "uses agentDir for the default persisted session path",
    usesAgentdirForTheDefaultPersistedSession,
  );

  it("keeps an explicit sessionManager override", keepsAnExplicitSessionmanagerOverride);

  it(
    "derives cwd from an explicit sessionManager when cwd is omitted",
    derivesCwdFromAnExplicitSessionmanagerWhen,
  );

  it(
    "exposes current session state to the built-in bash tool",
    exposesCurrentSessionStateToTheBuilt,
  );
});
