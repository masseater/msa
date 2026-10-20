import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createInMemoryModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } =
  testing;

let tempDir: string;

let extensionsDir: string;

let sessionManager: SessionManager;

let modelRegistry: ModelRegistry;

const chainsContentModificationsAcrossHandlersPart1 = () =>
  Effect.sync(() => {
    const extCode1 = `
				export default function(msa) {
					msa.on("tool_result", async (event) => {
						return {
							content: [...event.content, { type: "text", text: "ext1" }],
						};
					});
				}
			`;
    return { extCode1 };
  });

const chainsContentModificationsAcrossHandlers = Effect.gen(function* () {
  const { extCode1 } = yield* chainsContentModificationsAcrossHandlersPart1();
  const extCode2 = `
				export default function(msa) {
					msa.on("tool_result", async (event) => {
						return {
							content: [...event.content, { type: "text", text: "ext2" }],
						};
					});
				}
			`;
  yield* writeTextFile(joinPath(extensionsDir, "tool-result-1.ts"), extCode1);
  yield* writeTextFile(joinPath(extensionsDir, "tool-result-2.ts"), extCode2);

  const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
  const runner = new ExtensionRunner(
    result.extensions,
    result.runtime,
    tempDir,
    sessionManager,
    modelRegistry,
  );

  const chained = yield* awaited(
    runner.emitToolResult({
      content: [{ text: "base", type: "text" as const }],
      details: { initial: true },
      input: {},
      isError: false,
      toolCallId: "call-1",
      toolName: "my_tool",
      type: "tool_result" as const,
    }),
  );

  expect(chained).toBeDefined();
  const chainedContent = chained?.content;
  expect(chainedContent).toBeDefined();
  expect(chainedContent![0]).toEqual({ text: "base", type: "text" as const });
  expect(chainedContent).toHaveLength(3);
  const appendedText = chainedContent!
    .slice(1)
    .filter((item): item is { type: "text"; text: string } => item.type === "text")
    .map((item) => item.text);
  expect(appendedText.sort()).toEqual(["ext1", "ext2"]);
});

const preservesPreviousModificationsWhenLaterHandlersReturn = Effect.gen(function* () {
  const extCode1 = `
				export default function(msa) {
					msa.on("tool_result", async () => {
						return {
							content: [{ type: "text", text: "first" }],
							details: { source: "ext1" },
						};
					});
				}
			`;
  const extCode2 = `
				export default function(msa) {
					msa.on("tool_result", async () => {
						return {
							isError: true,
						};
					});
				}
			`;
  yield* writeTextFile(joinPath(extensionsDir, "tool-result-partial-1.ts"), extCode1);
  yield* writeTextFile(joinPath(extensionsDir, "tool-result-partial-2.ts"), extCode2);

  const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
  const runner = new ExtensionRunner(
    result.extensions,
    result.runtime,
    tempDir,
    sessionManager,
    modelRegistry,
  );

  const chained = yield* awaited(
    runner.emitToolResult({
      content: [{ text: "base", type: "text" as const }],
      details: { initial: true },
      input: {},
      isError: false,
      toolCallId: "call-2",
      toolName: "my_tool",
      type: "tool_result" as const,
    }),
  );

  expect(chained).toEqual({
    content: [{ text: "first", type: "text" as const }],
    details: { source: "ext1" },
    isError: true,
  });
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

  describe("tool_result chaining", () => {
    it("chains content modifications across handlers", () =>
      runTest(chainsContentModificationsAcrossHandlers));

    it("preserves previous modifications when later handlers return partial patches", () =>
      runTest(preservesPreviousModificationsWhenLaterHandlersReturn));
  });
});
