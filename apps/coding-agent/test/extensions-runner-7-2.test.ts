import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import ExtensionRunner from "../src/core/extensions/extension-runner.ts";
import loader from "../src/core/extensions/loader.ts";
import type runnerTypes from "../src/core/extensions/runner.types.ts";
import codingAgent from "../src/index.ts";
import type codingAgentTypes from "../src/index.types.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createEventBus } = codingAgent;

const { SessionManager } = codingAgent;

const { createExtensionRuntime, loadExtensionFromFactory } = loader;
const { createInMemoryModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest } = testing;

let tempDir: string;

let extensionsDir: string;

let sessionManager: codingAgentTypes.SessionManager;

let modelRegistry: codingAgentTypes.ModelRegistry;

const chainsSharedDraftProposalsAndPreservesOmittedSetup = () =>
  Effect.gen(function* () {
    const runtime = createExtensionRuntime();
    const eventBus = createEventBus();
    const observations: Array<{ entries: number; continuation: boolean; preview: number }> = [];
    const first = yield* awaited(
      loadExtensionFromFactory(
        (msa) => {
          msa.on("agent_before_settle", (event) => {
            observations.push({
              continuation: event.continue,
              entries: event.entries.length,
              preview: event.context.contextEntries.length,
            });
            event.entries.push({ customType: "first", data: 1, type: "custom" as const });
            return { continue: true };
          });
        },
        tempDir,
        eventBus,
        runtime,
        "<inline:first>",
      ),
    );
    const second = yield* awaited(
      loadExtensionFromFactory(
        (msa) => {
          msa.on("agent_before_settle", (event) => {
            observations.push({
              continuation: event.continue,
              entries: event.entries.length,
              preview: event.context.contextEntries.length,
            });
            return { entries: [] };
          });
        },
        tempDir,
        eventBus,
        runtime,
        "<inline:second>",
      ),
    );
    return { first, observations, runtime, second };
  });

const chainsSharedDraftProposalsAndPreservesOmitted = Effect.gen(function* () {
  const { first, observations, runtime, second } =
    yield* chainsSharedDraftProposalsAndPreservesOmittedSetup();
  const runner = new ExtensionRunner(
    [first, second],
    runtime,
    tempDir,
    sessionManager,
    modelRegistry,
  );

  const result = yield* awaited(
    runner.emitBoundary(
      { outcome: "completed", type: "agent_before_settle" as const },
      (entries) => ({
        canContinue: false,
        contextEntries: entries.map((entry, index) => ({
          messages: [],
          sourceEntry: {
            customType: entry.type,
            id: `draft-${index}`,
            parentId: null,
            timestamp: "",
            type: "custom" as const,
          },
        })),
        contextMessages: [],
        llmMessages: [],
        pendingMessages: [],
      }),
    ),
  );

  expect(observations).toEqual([
    { continuation: false, entries: 0, preview: 0 },
    { continuation: true, entries: 1, preview: 1 },
  ]);
  expect(result.entries).toEqual([]);
  expect(result.continue).toBe(true);
});

const reportsInvalidBoundaryPreviewsAndLetsLaterStep1Step = ({
  runner,
}: {
  runner: runnerTypes.ExtensionRunner;
}) =>
  Effect.gen(function* () {
    const errors: string[] = [];
    runner.onError((error) => errors.push(error.error));
    const result = yield* awaited(
      runner.emitBoundary(
        { outcome: "completed", type: "agent_before_settle" as const },
        (entries) => {
          if (entries.some((entry) => entry.type === "context_edit"))
            throw new Error("Entry missing not found");
          return {
            canContinue: false,
            contextEntries: [],
            contextMessages: [],
            llmMessages: [],
            pendingMessages: [],
          };
        },
      ),
    );
    return { errors, result };
  });

const reportsInvalidBoundaryPreviewsAndLetsLaterStep1 = () =>
  Effect.gen(function* () {
    const runtime = createExtensionRuntime();
    let secondRan = false;
    const first = yield* awaited(
      loadExtensionFromFactory(
        (msa) => {
          msa.on("agent_before_settle", () => ({
            entries: [{ replacement: null, targetId: "missing", type: "context_edit" as const }],
          }));
        },
        tempDir,
        createEventBus(),
        runtime,
        "<inline:invalid>",
      ),
    );
    const second = yield* awaited(
      loadExtensionFromFactory(
        (msa) => {
          msa.on("agent_before_settle", (event) => {
            secondRan = true;
            expect(event.entries).toHaveLength(1);
            return { entries: [] };
          });
        },
        tempDir,
        createEventBus(),
        runtime,
        "<inline:repair>",
      ),
    );
    const runner = new ExtensionRunner(
      [first, second],
      runtime,
      tempDir,
      sessionManager,
      modelRegistry,
    );
    const { errors, result } = yield* reportsInvalidBoundaryPreviewsAndLetsLaterStep1Step({
      runner,
    });

    expect(secondRan).toBe(true);
    return { errors, result };
  });

const reportsInvalidBoundaryPreviewsAndLetsLater = Effect.gen(function* () {
  const { errors, result } = yield* reportsInvalidBoundaryPreviewsAndLetsLaterStep1();
  expect(errors).toContain("Invalid boundary entries: Entry missing not found");
  expect(result.entries).toEqual([]);
  expect(result.valid).toBe(true);
});

const keepsSharedMutationsMadeBeforeAHandler = Effect.gen(function* () {
  const runtime = createExtensionRuntime();
  const extension = yield* awaited(
    loadExtensionFromFactory(
      (msa) => {
        msa.on("agent_before_settle", (event) => {
          event.entries.push({ customType: "kept", type: "custom" as const });
          throw new Error("boundary failed");
        });
      },
      tempDir,
      createEventBus(),
      runtime,
    ),
  );
  const runner = new ExtensionRunner([extension], runtime, tempDir, sessionManager, modelRegistry);
  const errors: string[] = [];
  runner.onError((error) => errors.push(error.error));

  const result = yield* awaited(
    runner.emitBoundary({ outcome: "completed", type: "agent_before_settle" as const }, () => ({
      canContinue: false,
      contextEntries: [],
      contextMessages: [],
      llmMessages: [],
      pendingMessages: [],
    })),
  );

  expect(result.entries).toMatchObject([{ customType: "kept", type: "custom" as const }]);
  expect(errors).toEqual(["boundary failed"]);
});

const beforeEachHook = Effect.gen(function* () {
  tempDir = yield* makeTempDir("msa-runner-test-");
  extensionsDir = joinPath(tempDir, "extensions");
  yield* makeDirectory(extensionsDir);
  sessionManager = SessionManager.inMemory();
  modelRegistry = yield* awaited(createInMemoryModelRegistry(AuthStorage.inMemory()));
});

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(removePath(tempDir)));

  describe("boundary chaining", () => {
    it("chains shared draft proposals and preserves omitted result fields", () =>
      runTest(chainsSharedDraftProposalsAndPreservesOmitted));

    it("reports invalid boundary previews and lets later handlers repair the proposal", () =>
      runTest(reportsInvalidBoundaryPreviewsAndLetsLater));

    it("keeps shared mutations made before a handler throws", () =>
      runTest(keepsSharedMutationsMadeBeforeAHandler));
  });
});
