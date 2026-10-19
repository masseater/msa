import { Agent } from "@msa/agent-core";
import { getModel, streamSimple } from "@msa/ai/compat";
import {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  removePath,
  runTest,
  tempRoot,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import {
  createExtensionRuntime,
  type Extension,
  type SessionBeforeCompactEvent,
  type SessionCompactEvent,
  type SessionEvent,
} from "../src/core/extensions/index.ts";
import { readEnv } from "../src/core/process-env.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createCodingTools } from "../src/index.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

const API_KEY = readEnv("ANTHROPIC_OAUTH_TOKEN") || readEnv("ANTHROPIC_API_KEY");

describe.skipIf(!(API_KEY !== undefined && API_KEY.length > 0))("Compaction extensions", () => {
  let session: AgentSession;
  let tempDir: string;
  let capturedEvents: SessionEvent[];

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = joinPath(tempRoot(), `msa-compaction-extensions-test-${currentTimeMillis()}`);
        yield* makeDirectory(tempDir);
        capturedEvents = [];
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        if (session !== null && session !== undefined) {
          session.dispose();
        }
        if (tempDir.length > 0) {
          yield* removePath(tempDir);
        }
      }),
    ),
  );

  function createExtension(
    onBeforeCompact?: (
      event: SessionBeforeCompactEvent,
    ) => { cancel?: boolean; compaction?: any } | undefined,
    onCompact?: (event: SessionCompactEvent) => void,
  ): Extension {
    const handlers = new Map<string, ((event: any, ctx: any) => Promise<any>)[]>();

    handlers.set("session_before_compact", [
      (event: SessionBeforeCompactEvent) =>
        runTest(
          Effect.gen(function* () {
            capturedEvents.push(event);
            if (onBeforeCompact !== undefined) {
              return yield* awaited(onBeforeCompact(event));
            }
            return yield* awaited(undefined);
          }),
        ),
    ]);

    handlers.set("session_compact", [
      (event: SessionCompactEvent) =>
        runTest(
          Effect.gen(function* () {
            capturedEvents.push(event);
            if (onCompact !== undefined) {
              onCompact(event);
            }
            return yield* awaited(undefined);
          }),
        ),
    ]);

    return {
      path: "test-extension",
      resolvedPath: "/test/test-extension.ts",
      sourceInfo: createSyntheticSourceInfo("<test:test-extension>", { source: "test" }),
      handlers,
      tools: new Map(),
      messageRenderers: new Map(),
      commands: new Map(),
      flags: new Map(),
      shortcuts: new Map(),
    };
  }

  function createSession(extensions: Extension[]) {
    return runTest(
      Effect.gen(function* () {
        const model = getModel("anthropic-api", "claude-sonnet-4-5")!;
        const agent = new Agent({
          getApiKey: () => API_KEY,
          streamFn: streamSimple,
          initialState: {
            model,
            systemPrompt: "You are a helpful assistant. Be concise.",
            tools: createCodingTools(process.cwd()),
          },
        });

        const sessionManager = SessionManager.create(tempDir);
        const settingsManager = SettingsManager.create(tempDir, tempDir);
        settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
        const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
        const modelRegistry = yield* awaited(createModelRegistry(authStorage));

        const runtime = createExtensionRuntime();
        const resourceLoader = {
          ...createTestResourceLoader(),
          getExtensions: () => ({ extensions, errors: [], runtime }),
        };

        session = new AgentSession({
          agent,
          sessionManager,
          settingsManager,
          cwd: tempDir,
          modelRuntime: getModelRuntime(modelRegistry),
          resourceLoader,
        });

        return yield* awaited(session);
      }),
    );
  }

  it(
    "should emit before_compact and compact events",
    () =>
      runTest(
        Effect.gen(function* () {
          const extension = createExtension();
          yield* awaited(createSession([extension]));

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.prompt("What is 3+3? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.compact());

          const beforeCompactEvents = capturedEvents.filter(
            (e): e is SessionBeforeCompactEvent => e.type === "session_before_compact",
          );
          const compactEvents = capturedEvents.filter(
            (e): e is SessionCompactEvent => e.type === "session_compact",
          );

          expect(beforeCompactEvents.length).toBe(1);
          expect(compactEvents.length).toBe(1);

          const beforeEvent = beforeCompactEvents[0];
          if (beforeEvent === undefined) throw new Error("expected a session_before_compact event");
          expect(beforeEvent.preparation).toBeDefined();
          expect(beforeEvent.preparation.messagesToSummarize).toBeDefined();
          expect(beforeEvent.preparation.turnPrefixMessages).toBeDefined();
          expect(beforeEvent.preparation.tokensBefore).toBeGreaterThanOrEqual(0);
          expect(typeof beforeEvent.preparation.isSplitTurn).toBe("boolean");
          expect(beforeEvent.branchEntries).toBeDefined();

          const afterEvent = compactEvents[0];
          if (afterEvent === undefined) throw new Error("expected a session_compact event");
          expect(afterEvent.compactionEntry).toBeDefined();
          expect(afterEvent.compactionEntry.summary.length).toBeGreaterThan(0);
          expect(afterEvent.compactionEntry.tokensBefore).toBeGreaterThanOrEqual(0);
          expect(afterEvent.fromExtension).toBe(false);
        }),
      ),
    120000,
  );

  it(
    "should allow extensions to cancel compaction",
    () =>
      runTest(
        Effect.gen(function* () {
          const extension = createExtension(() => ({ cancel: true }));
          yield* awaited(createSession([extension]));

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(expect(session.compact()).rejects.toThrow("Compaction cancelled"));

          const compactEvents = capturedEvents.filter((e) => e.type === "session_compact");
          expect(compactEvents.length).toBe(0);
        }),
      ),
    120000,
  );

  it(
    "should allow extensions to provide custom compaction",
    () =>
      runTest(
        Effect.gen(function* () {
          const customSummary = "Custom summary from extension";

          const extension = createExtension((event) => {
            if (event.type === "session_before_compact") {
              return {
                compaction: {
                  summary: customSummary,
                  firstKeptEntryId: event.preparation.firstKeptEntryId,
                  tokensBefore: event.preparation.tokensBefore,
                },
              };
            }
            return undefined;
          });
          yield* awaited(createSession([extension]));

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.prompt("What is 3+3? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          const result = yield* awaited(session.compact());

          expect(result.summary).toBe(customSummary);

          const compactEvents = capturedEvents.filter((e) => e.type === "session_compact");
          expect(compactEvents.length).toBe(1);

          const afterEvent = compactEvents[0];
          if (afterEvent === undefined) throw new Error("expected a session_compact event");
          if (afterEvent.type === "session_compact") {
            expect(afterEvent.compactionEntry.summary).toBe(customSummary);
            expect(afterEvent.fromExtension).toBe(true);
          }
        }),
      ),
    120000,
  );

  it(
    "should include entries in compact event after compaction is saved",
    () =>
      runTest(
        Effect.gen(function* () {
          const extension = createExtension();
          yield* awaited(createSession([extension]));

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.compact());

          const compactEvents = capturedEvents.filter((e) => e.type === "session_compact");
          expect(compactEvents.length).toBe(1);

          const afterEvent = compactEvents[0];
          if (afterEvent === undefined) throw new Error("expected a session_compact event");
          if (afterEvent.type === "session_compact") {
            const entries = session.sessionManager.getEntries();
            const hasCompactionEntry = entries.some(
              (e: { type: string }) => e.type === "compaction",
            );
            expect(hasCompactionEntry).toBe(true);
          }
        }),
      ),
    120000,
  );

  it(
    "should continue with default compaction if extension throws error",
    () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const throwingExtension: Extension = {
            path: "throwing-extension",
            resolvedPath: "/test/throwing-extension.ts",
            sourceInfo: createSyntheticSourceInfo("<test:throwing-extension>", { source: "test" }),
            handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
              [
                "session_before_compact",
                [
                  (event: SessionBeforeCompactEvent) =>
                    effectRunPromise(
                      Effect.sync(() => {
                        capturedEvents.push(event);
                        throw new Error("Extension intentionally throws");
                      }),
                    ),
                ],
              ],
              [
                "session_compact",
                [
                  (event: SessionCompactEvent) =>
                    effectRunPromise(
                      Effect.gen(function* () {
                        capturedEvents.push(event);
                        return yield* awaited(undefined);
                      }),
                    ),
                ],
              ],
            ]),
            tools: new Map(),
            messageRenderers: new Map(),
            commands: new Map(),
            flags: new Map(),
            shortcuts: new Map(),
          };

          yield* awaited(createSession([throwingExtension]));

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          const result = yield* awaited(session.compact());

          expect(result.summary).toBeDefined();
          expect(result.summary.length).toBeGreaterThan(0);

          const compactEvents = capturedEvents.filter(
            (e): e is SessionCompactEvent => e.type === "session_compact",
          );
          expect(compactEvents.length).toBe(1);
          expect(compactEvents[0]?.fromExtension).toBe(false);
        }),
      ),
    120000,
  );

  it(
    "should call multiple extensions in order",
    () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const callOrder: string[] = [];

          const extension1: Extension = {
            path: "extension1",
            resolvedPath: "/test/extension1.ts",
            sourceInfo: createSyntheticSourceInfo("<test:extension1>", { source: "test" }),
            handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
              [
                "session_before_compact",
                [
                  () =>
                    effectRunPromise(
                      Effect.gen(function* () {
                        callOrder.push("extension1-before");
                        return yield* awaited(undefined);
                      }),
                    ),
                ],
              ],
              [
                "session_compact",
                [
                  () =>
                    effectRunPromise(
                      Effect.gen(function* () {
                        callOrder.push("extension1-after");
                        return yield* awaited(undefined);
                      }),
                    ),
                ],
              ],
            ]),
            tools: new Map(),
            messageRenderers: new Map(),
            commands: new Map(),
            flags: new Map(),
            shortcuts: new Map(),
          };

          const extension2: Extension = {
            path: "extension2",
            resolvedPath: "/test/extension2.ts",
            sourceInfo: createSyntheticSourceInfo("<test:extension2>", { source: "test" }),
            handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
              [
                "session_before_compact",
                [
                  () =>
                    effectRunPromise(
                      Effect.gen(function* () {
                        callOrder.push("extension2-before");
                        return yield* awaited(undefined);
                      }),
                    ),
                ],
              ],
              [
                "session_compact",
                [
                  () =>
                    effectRunPromise(
                      Effect.gen(function* () {
                        callOrder.push("extension2-after");
                        return yield* awaited(undefined);
                      }),
                    ),
                ],
              ],
            ]),
            tools: new Map(),
            messageRenderers: new Map(),
            commands: new Map(),
            flags: new Map(),
            shortcuts: new Map(),
          };

          yield* awaited(createSession([extension1, extension2]));

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.compact());

          expect(callOrder).toEqual([
            "extension1-before",
            "extension2-before",
            "extension1-after",
            "extension2-after",
          ]);
        }),
      ),
    120000,
  );

  it(
    "should pass correct data in before_compact event",
    () =>
      runTest(
        Effect.gen(function* () {
          let capturedBeforeEvent: SessionBeforeCompactEvent | null = null;

          const extension = createExtension((event) => {
            capturedBeforeEvent = event;
            return undefined;
          });
          yield* awaited(createSession([extension]));

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.prompt("What is 3+3? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          yield* awaited(session.compact());

          expect(capturedBeforeEvent).not.toBeNull();
          const event = capturedBeforeEvent!;
          expect(typeof event.preparation.isSplitTurn).toBe("boolean");
          expect(event.preparation.firstKeptEntryId).toBeDefined();

          expect(Array.isArray(event.preparation.messagesToSummarize)).toBe(true);
          expect(Array.isArray(event.preparation.turnPrefixMessages)).toBe(true);

          expect(typeof event.preparation.tokensBefore).toBe("number");

          expect(Array.isArray(event.branchEntries)).toBe(true);

          expect(typeof session.sessionManager.getEntries).toBe("function");
          expect(typeof session.modelRuntime.getAuth).toBe("function");

          const entries = session.sessionManager.getEntries();
          expect(Array.isArray(entries)).toBe(true);
          expect(entries.length).toBeGreaterThan(0);
        }),
      ),
    120000,
  );

  it(
    "should use extension compaction even with different values",
    () =>
      runTest(
        Effect.gen(function* () {
          const customSummary = "Custom summary with modified values";

          const extension = createExtension((event) => {
            if (event.type === "session_before_compact") {
              return {
                compaction: {
                  summary: customSummary,
                  firstKeptEntryId: event.preparation.firstKeptEntryId,
                  tokensBefore: 999,
                },
              };
            }
            return undefined;
          });
          yield* awaited(createSession([extension]));

          yield* awaited(session.prompt("What is 2+2? Reply with just the number."));
          yield* awaited(session.agent.waitForIdle());

          const result = yield* awaited(session.compact());

          expect(result.summary).toBe(customSummary);
          expect(result.tokensBefore).toBe(999);
        }),
      ),
    120000,
  );
});
