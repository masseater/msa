import { tmpdir } from "node:os";

import { fauxAssistantMessage, registerFauxProvider } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  randomSuffixSync,
  makeDirectory,
  removePath,
  joinPath,
  dirnameOf,
} from "@msa/testing";
import { Effect } from "effect";
import neo4j from "neo4j-driver";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { readEnv } from "../src/core/process-env.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const password = readEnv("NEO4J_PASSWORD");
const project = `sdk-test-${currentTimeMillis()}-${randomSuffixSync()}`;
const tempDir = joinPath(tmpdir(), project);

afterAll(() =>
  runTest(
    Effect.gen(function* () {
      yield* removePath(tempDir);
      if (!password) return;
      const driver = neo4j.driver(
        readEnv("NEO4J_URI") ?? "bolt://localhost:7687",
        neo4j.auth.basic(readEnv("NEO4J_USERNAME") ?? "neo4j", password),
      );
      yield* awaited(
        driver.executeQuery("MATCH (s:MsaSession {project: $project}) DETACH DELETE s", {
          project,
        }),
      );
      yield* awaited(driver.close());
    }),
  ),
);

describe.runIf(password)("orchestrator workers", () => {
  it("keep their transcripts out of the sessions --continue and /resume pick from", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* makeDirectory(tempDir);
        const sessionDir = joinPath(tempDir, "sessions");
        const faux = registerFauxProvider();
        faux.setResponses([fauxAssistantMessage("done"), fauxAssistantMessage("reviewed")]);
        const model = faux.getModel();
        const authStorage = AuthStorage.inMemory();
        yield* awaited(
          authStorage.modify(model.provider, () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "faux-key" })),
          ),
        );
        const modelRuntime = yield* awaited(
          ModelRuntime.create({
            credentials: authStorage,
            modelsPath: joinPath(tempDir, "models.json"),
          }),
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
        const sessionManager = SessionManager.create(tempDir, sessionDir, { id: project });
        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir: tempDir,
            modelRuntime,
            model,
            sessionManager,
            orchestrator: true,
          }),
        );
        sessionManager.appendMessage({
          role: "user",
          content: "start",
          timestamp: currentTimeMillis(),
        });
        const orchestrator = session.orchestrator;
        if (!orchestrator) throw new Error("orchestrator missing");

        const { session: started } = yield* awaited(
          orchestrator.start({
            title: "t",
            prompt: "do t",
            dependsOn: [],
          }),
        );
        yield* awaited(
          expect
            .poll(
              () =>
                effectRunPromise(
                  Effect.gen(function* () {
                    return (yield* awaited(orchestrator.read(started.id))).status;
                  }),
                ),
              { timeout: 10_000 },
            )
            .toBe("completed"),
        );

        const worker = yield* awaited(orchestrator.read(started.id));
        expect(dirnameOf(worker.sessionFile ?? "")).toBe(joinPath(sessionDir, "workers"));
        expect(SessionManager.continueRecent(tempDir, sessionDir).getSessionFile()).toBe(
          sessionManager.getSessionFile(),
        );
        session.dispose();
      }),
    ));
});
