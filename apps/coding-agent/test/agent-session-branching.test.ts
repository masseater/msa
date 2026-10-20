import { tmpdir } from "node:os";

import { getModel } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import type { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import utilities from "./utilities.ts";

const { API_KEY } = utilities;

const { awaited, currentTimeMillis, joinPath, makeDirectory, pathExists, removePath, runTest } =
  testing;

let session: AgentSession;

let runtimeHost: AgentSessionRuntime;

let tempDir: string;

let sessionManager: SessionManager;

const createSessionPart1 = (input: { readonly noSession: boolean }) =>
  Effect.gen(function* () {
    const { noSession } = input;
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const model = getModel("anthropic-api", "claude-sonnet-4-5")!;
    sessionManager = noSession ? SessionManager.inMemory(tempDir) : SessionManager.create(tempDir);
    const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
    yield* awaited(
      authStorage.modify("anthropic-api", () =>
        effectRunPromise(awaited({ key: API_KEY!, type: "api_key" as const })),
      ),
    );

    const servicesOptions = {
      agentDir: tempDir,
      authStorage,
      resourceLoaderOptions: {
        noExtensions: true,
        noPromptTemplates: true,
        noSkills: true,
        noThemes: true,
      },
    };
    return { effectRunPromise, model, servicesOptions };
  });

function createSession(noSession: boolean = false) {
  return runTest(
    Effect.gen(function* () {
      const { effectRunPromise, model, servicesOptions } = yield* createSessionPart1({ noSession });
      const createRuntime: CreateAgentSessionRuntimeFactory = ({
        cwd,
        sessionManager: innerSessionManager,
        sessionStartEvent,
      }) =>
        effectRunPromise(
          Effect.gen(function* () {
            const services = yield* awaited(
              createAgentSessionServices({
                ...servicesOptions,
                cwd,
              }),
            );
            return yield* awaited({
              ...(yield* awaited(
                createAgentSessionFromServices({
                  services,
                  sessionManager: innerSessionManager,
                  ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
                  model,
                  tools: ["read", "bash", "edit", "write"],
                }),
              )),
              diagnostics: services.diagnostics,
              services,
            });
          }),
        );
      runtimeHost = yield* awaited(
        createAgentSessionRuntime(createRuntime, {
          agentDir: tempDir,
          cwd: tempDir,
          sessionManager,
        }),
      );
      session = runtimeHost.session;
      session.subscribe(() => {});
      return yield* awaited(session);
    }),
  );
}

const shouldAllowForkingFromSingleMessage = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(createSession());

      yield* awaited(session.prompt("Say hello"));
      yield* awaited(session.agent.waitForIdle());

      const userMessages = session.getUserMessagesForForking();
      expect(userMessages.length).toBe(1);
      const [userMessage] = userMessages;
      if (userMessage === undefined) throw new Error("expected a user message to fork from");
      expect(userMessage.text).toBe("Say hello");

      const result = yield* awaited(runtimeHost.fork(userMessage.entryId));
      expect(result.cancelled).toBe(false);
      session = runtimeHost.session;
      expect(result.selectedText).toBe("Say hello");

      expect(session.messages.length).toBe(0);
      expect(session.sessionFile).not.toBeNull();
      expect(yield* pathExists(session.sessionFile!)).toBe(false);
    }),
  );

const shouldSupportInMemoryForkingInNo = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(createSession(true));

      expect(session.sessionFile).toBeUndefined();

      yield* awaited(session.prompt("Say hi"));
      yield* awaited(session.agent.waitForIdle());

      const userMessages = session.getUserMessagesForForking();
      expect(userMessages.length).toBe(1);
      expect(session.messages.length).toBeGreaterThan(0);

      const [userMessage] = userMessages;
      if (userMessage === undefined) throw new Error("expected a user message to fork from");
      const result = yield* awaited(runtimeHost.fork(userMessage.entryId));
      expect(result.cancelled).toBe(false);
      session = runtimeHost.session;
      expect(result.selectedText).toBe("Say hi");

      expect(session.messages.length).toBe(0);
      expect(session.sessionFile).toBeUndefined();
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(tmpdir(), `msa-branching-test-${currentTimeMillis()}`);
      yield* makeDirectory(tempDir);
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (runtimeHost !== null && runtimeHost !== undefined) {
        yield* awaited(runtimeHost.dispose());
      }
      if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
        yield* removePath(tempDir);
      }
    }),
  );

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))("AgentSession forking", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it("should allow forking from single message", shouldAllowForkingFromSingleMessage);

  it("should support in-memory forking in --no-session mode", shouldSupportInMemoryForkingInNo);
});

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))("AgentSession forking", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "should fork from middle of conversation",
    () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(createSession());

          yield* awaited(session.prompt("Say one"));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.prompt("Say two"));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.prompt("Say three"));
          yield* awaited(session.agent.waitForIdle());

          const userMessages = session.getUserMessagesForForking();
          expect(userMessages.length).toBe(3);

          const secondMessage = userMessages[1];
          if (secondMessage === undefined) throw new Error("expected a second user message");
          const result = yield* awaited(runtimeHost.fork(secondMessage.entryId));
          expect(result.cancelled).toBe(false);
          session = runtimeHost.session;
          expect(result.selectedText).toBe("Say two");

          expect(session.messages.length).toBe(2);
          expect(session.messages[0]?.role).toBe("user");
          expect(session.messages[1]?.role).toBe("assistant");
        }),
      ),
    60000,
  );
});
