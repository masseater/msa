import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { fauxAssistantMessage, registerFauxProvider } from "@msa/ai/compat";
import { Effect } from "effect";
import { afterAll, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { harness } from "./orchestrator-harness.ts";

const { waitFor } = harness;
const tempDir = `${tmpdir()}/msa-orchestrator-sdk-${process.pid}`;

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function registerModel(
  modelRuntime: ModelRuntime,
  model: NonNullable<ReturnType<ReturnType<typeof registerFauxProvider>["getModel"]>>,
): void {
  modelRuntime.registerProvider(model.provider, {
    baseUrl: model.baseUrl,
    api: model.api,
    models: [
      {
        id: model.id,
        name: model.name,
        api: model.api,
        reasoning: model.reasoning,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        baseUrl: model.baseUrl,
      },
    ],
  });
}

function createHarness(options?: { isWorker?: boolean }) {
  return Effect.gen(function* () {
    mkdirSync(tempDir, { recursive: true });
    const sessionDir = `${tempDir}/sessions`;
    const faux = registerFauxProvider();
    faux.setResponses(
      Array.from({ length: 6 }, (_, index) => fauxAssistantMessage(`reply ${index}`)),
    );
    const model = faux.getModel();
    const authStorage = AuthStorage.inMemory();
    yield* Effect.promise(() =>
      authStorage.modify(model.provider, () =>
        Promise.resolve({ type: "api_key", key: "faux-key" }),
      ),
    );
    const modelRuntime = yield* Effect.promise(() =>
      ModelRuntime.create({ credentials: authStorage, modelsPath: `${tempDir}/models.json` }),
    );
    registerModel(modelRuntime, model);
    const sessionManager = SessionManager.create(tempDir, sessionDir, { id: "sdk" });
    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        cwd: tempDir,
        agentDir: tempDir,
        modelRuntime,
        model,
        sessionManager,
        ...(options?.isWorker !== undefined ? { isWorker: options.isWorker } : {}),
      }),
    );
    sessionManager.appendMessage({ role: "user", content: "start", timestamp: 1 });
    return { session, sessionManager, sessionDir };
  });
}

it("starts with the orchestrator tools active", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session } = yield* createHarness();
      expect(session.getActiveToolNames()).toEqual(
        expect.arrayContaining(["create_task", "list_tasks", "replan", "stop_task"]),
      );
      expect(session.systemPrompt).toContain("You work as an orchestrator");
      session.dispose();
    }),
  ));

it("does not start an orchestrator inside a worker session", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session } = yield* createHarness({ isWorker: true });
      expect(session.orchestrator).toBeUndefined();
      expect(session.getActiveToolNames()).not.toContain("create_task");
      session.dispose();
    }),
  ));

it("keeps worker transcripts out of the sessions --continue and /resume pick from", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session, sessionManager, sessionDir } = yield* createHarness();
      const orchestrator = session.orchestrator;
      if (orchestrator === undefined) throw new Error("orchestrator missing");
      const task = yield* Effect.promise(() =>
        orchestrator.createTask({ title: "t", prompt: "do t" }),
      );
      yield* waitFor(
        () =>
          orchestrator.snapshot.tasks.find((item) => item.id === task.id)?.status === "completed",
        3000,
      );
      const worker = yield* Effect.promise(() => orchestrator.read(task.id));
      const assignment = worker.assignments.find((item) => item.role === "worker");
      const sessionFile = orchestrator.snapshot.sessions.find(
        (candidate) => candidate.id === assignment?.sessionId,
      )?.sessionFile;
      if (sessionFile === null || sessionFile === undefined) {
        throw new Error("worker session file missing");
      }
      expect(sessionFile.slice(0, sessionDir.length + "/workers".length)).toBe(
        `${sessionDir}/workers`,
      );
      expect(SessionManager.continueRecent(tempDir, sessionDir).getSessionFile()).toBe(
        sessionManager.getSessionFile(),
      );
      session.dispose();
    }),
  ));
