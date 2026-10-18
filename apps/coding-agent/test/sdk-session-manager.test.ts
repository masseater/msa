import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { getModel } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  randomSuffixSync,
  makeDirectory,
  joinPath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("createAgentSession session manager defaults", () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = joinPath(
      tmpdir(),
      `msa-sdk-session-test-${currentTimeMillis()}-${randomSuffixSync()}`,
    );
    cwd = joinPath(tempDir, "project");
    agentDir = joinPath(tempDir, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    if (tempDir.length > 0 && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses agentDir for the default persisted session path", () =>
    runTest(
      Effect.gen(function* () {
        const model = getModel("anthropic", "claude-sonnet-4-5");
        expect(model).toBeTruthy();

        const { session } = yield* awaited(
          createAgentSession({
            cwd,
            agentDir,
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
    ));

  it("keeps an explicit sessionManager override", () =>
    runTest(
      Effect.gen(function* () {
        const model = getModel("anthropic", "claude-sonnet-4-5");
        expect(model).toBeTruthy();

        const sessionManager = SessionManager.inMemory(cwd);
        const { session } = yield* awaited(
          createAgentSession({
            cwd,
            agentDir,
            model: model!,
            sessionManager,
          }),
        );

        expect(session.sessionManager).toBe(sessionManager);
        expect(session.sessionManager.isPersisted()).toBe(false);

        session.dispose();
      }),
    ));

  it("derives cwd from an explicit sessionManager when cwd is omitted", () =>
    runTest(
      Effect.gen(function* () {
        const model = getModel("anthropic", "claude-sonnet-4-5");
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

        expect(realpathSync(output.trim())).toBe(realpathSync(sessionCwd));

        session.dispose();
      }),
    ));

  it("exposes current session state to the built-in bash tool", () =>
    runTest(
      Effect.gen(function* () {
        const model = getModel("anthropic", "claude-sonnet-4-5");
        expect(model).toBeTruthy();

        const { session } = yield* awaited(
          createAgentSession({
            cwd,
            agentDir,
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
    ));
});
