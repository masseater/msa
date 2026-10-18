// oxlint-disable-next-line effecttsgo/node-builtin-import -- the test needs a scratch directory
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

function createHarness() {
  return Effect.gen(function* () {
    mkdirSync(tempDir, { recursive: true });
    const sessionDir = `${tempDir}/sessions`;
    const faux = registerFauxProvider();
    faux.setResponses(Array.from({ length: 6 }, (_, index) => fauxAssistantMessage(`reply ${index}`)));
    const model = faux.getModel();
    const authStorage = AuthStorage.inMemory();
    yield* Effect.promise(() =>
      authStorage.modify(model.provider, () => Promise.resolve({ type: "api_key", key: "faux-key" })),
    );
    const modelRuntime = yield* Effect.promise(() =>
      ModelRuntime.create({ credentials: authStorage, modelsPath: `${tempDir}/models.json` }),
    );
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
    const sessionManager = SessionManager.create(tempDir, sessionDir, { id: "sdk" });
    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        cwd: tempDir,
        agentDir: tempDir,
        modelRuntime,
        model,
        sessionManager,
        orchestrator: true,
      }),
    );
    sessionManager.appendMessage({ role: "user", content: "start", timestamp: 1 });
    return { session, sessionManager, sessionDir };
  });
}

it("keeps worker transcripts out of the sessions --continue and /resume pick from", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session, sessionManager, sessionDir } = yield* createHarness();
      const orchestrator = session.orchestrator;
      if (orchestrator === undefined) throw new Error("orchestrator missing");
      const task = yield* Effect.promise(() => orchestrator.createTask({ title: "t", prompt: "do t" }));
      yield* waitFor(
        () => orchestrator.snapshot.tasks.find((item) => item.id === task.id)?.status === "completed",
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
      expect(sessionFile.slice(0, sessionDir.length + "/workers".length)).toBe(`${sessionDir}/workers`);
      expect(SessionManager.continueRecent(tempDir, sessionDir).getSessionFile()).toBe(
        sessionManager.getSessionFile(),
      );
      session.dispose();
    }),
  ));
