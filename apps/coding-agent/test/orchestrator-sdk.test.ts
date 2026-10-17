import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fauxAssistantMessage, registerFauxProvider } from "@msa/ai/compat";
import neo4j from "neo4j-driver";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const password = process.env["NEO4J_PASSWORD"];
const project = `sdk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const tempDir = join(tmpdir(), project);

afterAll(async () => {
  rmSync(tempDir, { recursive: true, force: true });
  if (!password) return;
  const driver = neo4j.driver(
    process.env["NEO4J_URI"] ?? "bolt://localhost:7687",
    neo4j.auth.basic(process.env["NEO4J_USERNAME"] ?? "neo4j", password),
  );
  await driver.executeQuery("MATCH (s:MsaSession {project: $project}) DETACH DELETE s", {
    project,
  });
  await driver.close();
});

describe.runIf(password)("orchestrator workers", () => {
  it("keep their transcripts out of the sessions --continue and /resume pick from", async () => {
    mkdirSync(tempDir, { recursive: true });
    const sessionDir = join(tempDir, "sessions");
    const faux = registerFauxProvider();
    faux.setResponses([fauxAssistantMessage("done"), fauxAssistantMessage("reviewed")]);
    const model = faux.getModel();
    const authStorage = AuthStorage.inMemory();
    await authStorage.modify(model.provider, async () => ({ type: "api_key", key: "faux-key" }));
    const modelRuntime = await ModelRuntime.create({
      credentials: authStorage,
      modelsPath: join(tempDir, "models.json"),
    });
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
    const { session } = await createAgentSession({
      cwd: tempDir,
      agentDir: tempDir,
      modelRuntime,
      model,
      sessionManager,
      orchestrator: true,
    });
    sessionManager.appendMessage({ role: "user", content: "start", timestamp: Date.now() });
    const orchestrator = session.orchestrator;
    if (!orchestrator) throw new Error("orchestrator missing");

    const { session: started } = await orchestrator.start({
      title: "t",
      prompt: "do t",
      dependsOn: [],
    });
    await expect
      .poll(async () => (await orchestrator.read(started.id)).status, { timeout: 10_000 })
      .toBe("completed");

    const worker = await orchestrator.read(started.id);
    expect(dirname(worker.sessionFile ?? "")).toBe(join(sessionDir, "workers"));
    expect(SessionManager.continueRecent(tempDir, sessionDir).getSessionFile()).toBe(
      sessionManager.getSessionFile(),
    );
    session.dispose();
  });
});
