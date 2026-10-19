import {
  abortController,
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import {
  createExtensionRuntime,
  discoverAndLoadExtensions,
  loadExtensionFromFactory,
  loadExtensions,
} from "../src/core/extensions/loader.ts";
import { ExtensionRunner, emitProjectTrustEvent } from "../src/core/extensions/runner.ts";
import type {
  ExtensionActions,
  ExtensionContextActions,
  ExtensionFactory,
  ExtensionUIContext,
  ProviderConfig,
} from "../src/core/extensions/types.ts";
import { KeybindingsManager, type KeyId } from "../src/core/keybindings.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import type { ScopedModel } from "../src/core/model-resolver.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";

describe("ExtensionRunner", () => {
  let tempDir: string;
  let extensionsDir: string;
  let sessionManager: SessionManager;
  let modelRegistry: ModelRegistry;
  const defaultKeybindings = new KeybindingsManager().getEffectiveConfig();

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = yield* makeTempDir("msa-runner-test-");
        extensionsDir = joinPath(tempDir, "extensions");
        yield* makeDirectory(extensionsDir);
        sessionManager = SessionManager.inMemory();
        modelRegistry = yield* awaited(createInMemoryModelRegistry(AuthStorage.inMemory()));
      }),
    ),
  );

  afterEach(() => runTest(removePath(tempDir)));

  const providerModelConfig: ProviderConfig = {
    baseUrl: "https://provider.test/v1",
    apiKey: "provider-test-key",
    api: "openai-completions" as const,
    models: [
      {
        id: "instant-model",
        name: "Instant Model",
        reasoning: false,
        input: ["text"],
        cost: {
          input: 1,
          output: 2,
          cacheRead: 0.1,
          cacheWrite: 1.25,
          tiers: [
            {
              inputTokensAbove: 272000,
              input: 2,
              output: 3,
              cacheRead: 0.2,
              cacheWrite: 2.5,
            },
          ],
        },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  };

  const extensionActions: ExtensionActions = {
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    getSettings: () => ({}),
    setActiveTools: () => {},
    refreshTools: () => {},
    getCommands: () => [],
    setModel: () => runTest(awaited(false)),
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {},
  };

  const extensionContextActions: ExtensionContextActions = {
    getModel: () => undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    getSignal: () => undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
    getScopedModels: () => [],
  };

  describe("scopedModels", () => {
    it("reflects the getScopedModels context action on ctx.scopedModels", () =>
      runTest(
        Effect.gen(function* () {
          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          expect(runner.createContext().scopedModels).toEqual([]);

          const scoped = [
            { model: { id: "scoped-test" }, thinkingLevel: "high" },
          ] as unknown as ScopedModel[];
          runner.bindCore(extensionActions, {
            ...extensionContextActions,
            getScopedModels: () => scoped,
          });
          expect(runner.createContext().scopedModels).toBe(scoped);
        }),
      ));
  });

  describe("project_trust", () => {
    it("continues past undecided handlers and returns the first yes/no decision", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const undecidedPath = joinPath(extensionsDir, "undecided.ts");
          const decidedPath = joinPath(extensionsDir, "decided.ts");
          yield* writeTextFile(
            undecidedPath,
            `export default function(msa) {
	msa.on("project_trust", () => ({ trusted: "undecided", remember: true }));
}`,
          );
          yield* writeTextFile(
            decidedPath,
            `export default function(msa) {
	msa.on("project_trust", () => ({ trusted: "no", remember: true }));
}`,
          );

          const extensionsResult = yield* awaited(
            loadExtensions([undecidedPath, decidedPath], tempDir),
          );
          const result = yield* awaited(
            emitProjectTrustEvent(
              extensionsResult,
              { type: "project_trust" as const, cwd: tempDir },
              {
                cwd: tempDir,
                mode: "tui",
                hasUI: false,
                ui: {
                  select: () => effectRunPromise(awaited(undefined)),
                  confirm: () => effectRunPromise(awaited(false)),
                  input: () => effectRunPromise(awaited(undefined)),
                  notify: () => {},
                },
              },
            ),
          );

          expect(result.result).toEqual({ trusted: "no", remember: true });
          expect(result.errors).toEqual([]);
        }),
      ));
  });

  describe("shortcut conflicts", () => {
    it("warns when extension shortcut conflicts with built-in", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerShortcut("ctrl+c", {
						description: "Conflicts with built-in",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "conflict.ts"), extCode);

          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const shortcuts = runner.getShortcuts(defaultKeybindings);

          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
          expect(shortcuts.has("ctrl+c")).toBe(false);

          warnSpy.mockRestore();
        }),
      ));

    it("allows a shortcut when the reserved set no longer contains the default key", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerShortcut("ctrl+p", {
						description: "Uses freed default",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "rebinding.ts"), extCode);

          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const keybindings = {
            ...defaultKeybindings,
            "app.model.cycleForward": "ctrl+n" as KeyId,
          };
          const shortcuts = runner.getShortcuts(keybindings);

          expect(shortcuts.has("ctrl+p")).toBe(true);
          expect(warnSpy).not.toHaveBeenCalledWith(
            expect.stringContaining("conflicts with built-in"),
          );

          warnSpy.mockRestore();
        }),
      ));

    it("warns but allows when extension uses non-reserved built-in shortcut", () =>
      runTest(
        Effect.gen(function* () {
          const pasteImageKey = Array.isArray(defaultKeybindings["app.clipboard.pasteImage"])
            ? (defaultKeybindings["app.clipboard.pasteImage"][0] ?? "")
            : defaultKeybindings["app.clipboard.pasteImage"];
          const extCode = `
				export default function(msa) {
					msa.registerShortcut("${pasteImageKey}", {
						description: "Overrides non-reserved",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "non-reserved.ts"), extCode);

          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const shortcuts = runner.getShortcuts(defaultKeybindings);

          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("built-in shortcut for app.clipboard.pasteImage"),
          );
          expect(shortcuts.has(pasteImageKey as KeyId)).toBe(true);

          warnSpy.mockRestore();
        }),
      ));

    it("blocks shortcuts for reserved actions even when rebound", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerShortcut("ctrl+x", {
						description: "Conflicts with rebound reserved",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "rebound-reserved.ts"), extCode);

          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const keybindings = { ...defaultKeybindings, "app.interrupt": "ctrl+x" as KeyId };
          const shortcuts = runner.getShortcuts(keybindings);

          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
          expect(shortcuts.has("ctrl+x")).toBe(false);

          warnSpy.mockRestore();
        }),
      ));

    it("blocks shortcuts when reserved key is also bound to non-reserved actions", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerShortcut("ctrl+p", {
						description: "Conflicts with shared reserved default",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "shared-reserved.ts"), extCode);

          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const shortcuts = runner.getShortcuts(defaultKeybindings);

          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
          expect(shortcuts.has("ctrl+p")).toBe(false);

          warnSpy.mockRestore();
        }),
      ));

    it("blocks shortcuts when reserved action has multiple keys", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerShortcut("ctrl+y", {
						description: "Conflicts with multi-key reserved",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "multi-reserved.ts"), extCode);

          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const keybindings = {
            ...defaultKeybindings,
            "app.clear": ["ctrl+x", "ctrl+y"] as KeyId[],
          };
          const shortcuts = runner.getShortcuts(keybindings);

          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
          expect(shortcuts.has("ctrl+y")).toBe(false);

          warnSpy.mockRestore();
        }),
      ));

    it("warns but allows when non-reserved action has multiple keys", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerShortcut("ctrl+y", {
						description: "Overrides multi-key non-reserved",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "multi-non-reserved.ts"), extCode);

          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const keybindings = {
            ...defaultKeybindings,
            "app.clipboard.pasteImage": ["ctrl+x", "ctrl+y"] as KeyId[],
          };
          const shortcuts = runner.getShortcuts(keybindings);

          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("built-in shortcut for app.clipboard.pasteImage"),
          );
          expect(shortcuts.has("ctrl+y")).toBe(true);

          warnSpy.mockRestore();
        }),
      ));

    it("warns when two extensions register same shortcut", () =>
      runTest(
        Effect.gen(function* () {
          const extCode1 = `
				export default function(msa) {
					msa.registerShortcut("ctrl+shift+x", {
						description: "First extension",
						handler: async () => {},
					});
				}
			`;
          const extCode2 = `
				export default function(msa) {
					msa.registerShortcut("ctrl+shift+x", {
						description: "Second extension",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "ext1.ts"), extCode1);
          yield* writeTextFile(joinPath(extensionsDir, "ext2.ts"), extCode2);

          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const shortcuts = runner.getShortcuts(defaultKeybindings);

          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("shortcut conflict"));

          expect(shortcuts.has("ctrl+shift+x")).toBe(true);

          warnSpy.mockRestore();
        }),
      ));
  });

  describe("tool collection", () => {
    it("collects tools from multiple extensions", () =>
      runTest(
        Effect.gen(function* () {
          const toolCode = (name: string) => `
				import { Type } from "typebox";
				export default function(msa) {
					msa.registerTool({
						name: "${name}",
						label: "${name}",
						description: "Test tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "tool-a.ts"), toolCode("tool_a"));
          yield* writeTextFile(joinPath(extensionsDir, "tool-b.ts"), toolCode("tool_b"));

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const tools = runner.getAllRegisteredTools();

          expect(tools.length).toBe(2);
          expect(tools.map((t) => t.definition.name).sort()).toEqual(["tool_a", "tool_b"]);
        }),
      ));

    it("rejects extension tools without a parameter schema", () =>
      runTest(
        Effect.gen(function* () {
          const extensionPath = joinPath(extensionsDir, "missing-parameters.js");
          yield* writeTextFile(
            extensionPath,
            `export default function(msa) {
	msa.registerTool({
		name: "noop",
		label: "No-op",
		description: "Do nothing",
		execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
	});
}`,
          );

          const result = yield* awaited(loadExtensions([extensionPath], tempDir));

          expect(result.extensions).toHaveLength(0);
          expect(result.errors).toEqual([
            {
              path: extensionPath,
              error: `Failed to load extension: Tool "noop" registered by extension "${extensionPath}" must define an object parameter schema.`,
            },
          ]);
        }),
      ));

    it("keeps first tool when two extensions register the same name", () =>
      runTest(
        Effect.gen(function* () {
          const first = `
				import { Type } from "typebox";
				export default function(msa) {
					msa.registerTool({
						name: "shared",
						label: "shared",
						description: "first",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
          const second = `
				import { Type } from "typebox";
				export default function(msa) {
					msa.registerTool({
						name: "shared",
						label: "shared",
						description: "second",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "a-first.ts"), first);
          yield* writeTextFile(joinPath(extensionsDir, "b-second.ts"), second);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const tools = runner.getAllRegisteredTools();

          expect(tools).toHaveLength(1);
          expect(tools[0]?.definition.description).toBe("first");
        }),
      ));
  });

  describe("command collection", () => {
    it("collects commands from multiple extensions", () =>
      runTest(
        Effect.gen(function* () {
          const cmdCode = (name: string) => `
				export default function(msa) {
					msa.registerCommand("${name}", {
						description: "Test command",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "cmd-a.ts"), cmdCode("cmd-a"));
          yield* writeTextFile(joinPath(extensionsDir, "cmd-b.ts"), cmdCode("cmd-b"));

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const commands = runner.getRegisteredCommands();

          expect(commands.length).toBe(2);
          expect(commands.map((c) => c.name).sort()).toEqual(["cmd-a", "cmd-b"]);
          expect(commands.map((c) => c.invocationName).sort()).toEqual(["cmd-a", "cmd-b"]);
        }),
      ));

    it("gets command by invocation name", () =>
      runTest(
        Effect.gen(function* () {
          const cmdCode = `
				export default function(msa) {
					msa.registerCommand("my-cmd", {
						description: "My command",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "cmd.ts"), cmdCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          const cmd = runner.getCommand("my-cmd");
          expect(cmd).toBeDefined();
          expect(cmd?.name).toBe("my-cmd");
          expect(cmd?.invocationName).toBe("my-cmd");
          expect(cmd?.description).toBe("My command");

          const missing = runner.getCommand("not-exists");
          expect(missing).toBeUndefined();
        }),
      ));

    it("suffixes duplicate extension commands in insertion order", () =>
      runTest(
        Effect.gen(function* () {
          const cmdCode = (description: string) => `
				export default function(msa) {
					msa.registerCommand("shared-cmd", {
						description: "${description}",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "cmd-a.ts"), cmdCode("First command"));
          yield* writeTextFile(joinPath(extensionsDir, "cmd-b.ts"), cmdCode("Second command"));

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const commands = runner.getRegisteredCommands();
          const diagnostics = runner.getCommandDiagnostics();

          expect(commands).toHaveLength(2);
          expect(commands.map((command) => command.name)).toEqual(["shared-cmd", "shared-cmd"]);
          expect(commands.map((command) => command.invocationName)).toEqual([
            "shared-cmd:1",
            "shared-cmd:2",
          ]);
          expect(commands.map((command) => command.description)).toEqual([
            "First command",
            "Second command",
          ]);
          expect(diagnostics).toEqual([]);
          expect(runner.getCommand("shared-cmd:1")?.description).toBe("First command");
          expect(runner.getCommand("shared-cmd:2")?.description).toBe("Second command");
        }),
      ));
  });

  describe("context creation", () => {
    it("exposes the current abort signal on ExtensionContext", () =>
      runTest(
        Effect.gen(function* () {
          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const controller = abortController();

          runner.bindCore(extensionActions, {
            ...extensionContextActions,
            getSignal: () => controller.signal,
          });

          const ctx = runner.createContext();
          expect(ctx.signal).toBe(controller.signal);
          expect(ctx.signal?.aborted).toBe(false);

          controller.abort();
          expect(ctx.signal?.aborted).toBe(true);
        }),
      ));

    it("exposes print mode and hasUI false by default", () =>
      runTest(
        Effect.gen(function* () {
          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          runner.bindCore(extensionActions, extensionContextActions);

          const ctx = runner.createContext();
          expect(ctx.mode).toBe("print");
          expect(ctx.hasUI).toBe(false);
        }),
      ));

    it("exposes project trust state on ExtensionContext", () =>
      runTest(
        Effect.gen(function* () {
          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          runner.bindCore(extensionActions, {
            ...extensionContextActions,
            isProjectTrusted: () => false,
          });

          const ctx = runner.createContext();
          expect(ctx.isProjectTrusted()).toBe(false);
        }),
      ));

    it("exposes rpc mode with hasUI true when an RPC UI context is provided", () =>
      runTest(
        Effect.gen(function* () {
          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          runner.bindCore(extensionActions, extensionContextActions);
          runner.setUIContext({} as ExtensionUIContext, "rpc");

          const ctx = runner.createContext();
          expect(ctx.mode).toBe("rpc");
          expect(ctx.hasUI).toBe(true);
        }),
      ));

    it("exposes tui mode with hasUI true when a TUI UI context is provided", () =>
      runTest(
        Effect.gen(function* () {
          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          runner.bindCore(extensionActions, extensionContextActions);
          runner.setUIContext({} as ExtensionUIContext, "tui");

          const ctx = runner.createContext();
          expect(ctx.mode).toBe("tui");
          expect(ctx.hasUI).toBe(true);
        }),
      ));
  });

  describe("error handling", () => {
    it("calls error listeners when handler throws", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.on("context", async () => {
						throw new Error("Handler error!");
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "throws.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          const errors: Array<{ extensionPath: string; event: string; error: string }> = [];
          runner.onError((err) => {
            errors.push(err);
          });

          yield* awaited(runner.emitContext([]));

          expect(errors.length).toBe(1);
          expect(errors[0]?.error).toContain("Handler error!");
          expect(errors[0]?.event).toBe("context");
        }),
      ));

    it("fails closed when a user_bash handler throws", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.on("user_bash", async () => {
						throw new Error("Routing failed");
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "throws.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const errors: Array<{ event: string; error: string }> = [];
          runner.onError((error) => errors.push(error));

          yield* awaited(
            expect(
              runner.emitUserBash({
                type: "user_bash" as const,
                command: "pwd",
                excludeFromContext: false,
                cwd: tempDir,
              }),
            ).rejects.toThrow("Routing failed"),
          );
          expect(errors).toMatchObject([{ event: "user_bash", error: "Routing failed" }]);
        }),
      ));

    it.each([
      ["an empty object", "{}"],
      ["null operations", "{ operations: null }"],
      ["operations without exec", "{ operations: {} }"],
      ["a null result", "{ result: null }"],
      ["an incomplete result", '{ result: { output: "handled" } }'],
      [
        "operations and a result",
        '{ operations: { exec: async () => ({ exitCode: 0 }) }, result: { output: "handled", exitCode: 0, cancelled: false, truncated: false } }',
      ],
    ])("fails closed when a user_bash handler returns %s", (_description, handlerResult) =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.on("user_bash", async () => (${handlerResult}));
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "invalid-result.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const errors: Array<{ event: string; error: string }> = [];
          runner.onError((error) => errors.push(error));

          yield* awaited(
            expect(
              runner.emitUserBash({
                type: "user_bash" as const,
                command: "pwd",
                excludeFromContext: false,
                cwd: tempDir,
              }),
            ).rejects.toThrow("Invalid user_bash handler result"),
          );
          expect(errors).toMatchObject([
            {
              event: "user_bash",
              error: expect.stringContaining("Invalid user_bash handler result"),
            },
          ]);
        }),
      ),
    );

    it("accepts valid user_bash operations and result overrides", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.on("user_bash", async (event) => {
						if (event.command === "operations") {
							return { operations: { exec: async () => ({ exitCode: 0 }) } };
						}
						return { result: { output: "handled", exitCode: 0, cancelled: false, truncated: false } };
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "valid-results.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const event = { type: "user_bash" as const, excludeFromContext: false, cwd: tempDir };

          const operations = yield* awaited(
            runner.emitUserBash({ ...event, command: "operations" }),
          );
          expect(operations).toEqual({ operations: { exec: expect.any(Function) } });
          yield* awaited(
            expect(runner.emitUserBash({ ...event, command: "result" })).resolves.toEqual({
              result: { output: "handled", exitCode: 0, cancelled: false, truncated: false },
            }),
          );
        }),
      ));
  });

  describe("message and entry renderers", () => {
    it("gets Markdown transformers in extension load order", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerMarkdownTransformer((markdown) => markdown);
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "markdown-renderer-a.ts"), extCode);
          yield* writeTextFile(joinPath(extensionsDir, "markdown-renderer-b.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          expect(runner.getMarkdownTransformers()).toHaveLength(2);
        }),
      ));

    it("gets message renderer by type", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerMessageRenderer("my-type", (message, options, theme) => null);
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "renderer.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          const renderer = runner.getMessageRenderer("my-type");
          expect(renderer).toBeDefined();

          const missing = runner.getMessageRenderer("not-exists");
          expect(missing).toBeUndefined();
        }),
      ));

    it("gets entry renderer by type", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerEntryRenderer("my-entry", (entry, options, theme) => null);
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "entry-renderer.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          expect(runner.getEntryRenderer("my-entry")).toBeDefined();
          expect(runner.getEntryRenderer("not-exists")).toBeUndefined();
        }),
      ));
  });

  describe("flags", () => {
    it("collects flags from extensions", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerFlag("my-flag", {
						description: "My flag",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "with-flag.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const flags = runner.getFlags();

          expect(flags.has("my-flag")).toBe(true);
        }),
      ));

    it("keeps first flag when two extensions register the same name", () =>
      runTest(
        Effect.gen(function* () {
          const first = `
				export default function(msa) {
					msa.registerFlag("shared-flag", {
						description: "first",
						type: "boolean",
						default: true,
					});
				}
			`;
          const second = `
				export default function(msa) {
					msa.registerFlag("shared-flag", {
						description: "second",
						type: "boolean",
						default: false,
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "a-first.ts"), first);
          yield* writeTextFile(joinPath(extensionsDir, "b-second.ts"), second);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const flags = runner.getFlags();

          expect(flags.get("shared-flag")?.description).toBe("first");
          expect(result.runtime.flagValues.get("shared-flag")).toBe(true);
        }),
      ));

    it("rejects default values that do not match the flag type", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerFlag("safe-mode", {
						type: "boolean",
						default: "false",
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "bad-flag-default.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

          expect(result.extensions).toHaveLength(0);
          expect(result.errors[0]?.error).toContain(
            'Invalid default for flag "safe-mode": expected boolean, got string',
          );
          expect(result.runtime.flagValues.has("safe-mode")).toBe(false);
        }),
      ));

    it("can set flag values", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.registerFlag("test-flag", {
						description: "Test flag",
						handler: async () => {},
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "flag.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          runner.setFlagValue("--test-flag", true);

          expect(result.runtime.flagValues.get("--test-flag")).toBe(true);
        }),
      ));
  });

  describe("before_agent_start", () => {
    it("keeps ctx.getSystemPrompt() in sync with chained system prompt updates", () =>
      runTest(
        Effect.gen(function* () {
          const extCode1 = `
				export default function(msa) {
					msa.on("before_agent_start", async (_event, ctx) => {
						return {
							systemPrompt: ctx.getSystemPrompt() + "\\nfirst",
						};
					});
				}
			`;
          const extCode2 = `
				export default function(msa) {
					msa.on("before_agent_start", async (_event, ctx) => {
						return {
							systemPrompt: ctx.getSystemPrompt() + "\\nsecond",
						};
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "before-agent-start-1.ts"), extCode1);
          yield* writeTextFile(joinPath(extensionsDir, "before-agent-start-2.ts"), extCode2);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          expect(result.errors).toEqual([]);
          expect(result.extensions).toHaveLength(2);
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const errors: string[] = [];
          runner.onError((error) => errors.push(error.error));
          runner.bindCore(extensionActions, extensionContextActions);

          const chained = yield* awaited(
            runner.emitBeforeAgentStart(
              { messageType: "user", prompt: "hello" },
              {
                cwd: tempDir,
                customPrompt: "base",
              },
            ),
          );

          expect(errors).toEqual([]);
          expect(chained.messages).toEqual([]);
          expect(buildSystemPrompt(chained.systemPromptOptions)).toMatch(
            /base[\s\S]*\nfirst\nsecond$/u,
          );
        }),
      ));
  });

  it("resolves tool renderers in extension load order, each able to defer to the next", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = createExtensionRuntime();
        const eventBus = createEventBus();
        const renderCall = () => ({ render: () => [], invalidate: () => {} });
        const first = yield* awaited(
          loadExtensionFromFactory(
            (msa) =>
              msa.registerToolRenderer((toolName, next) =>
                toolName === "a" ? { renderCall } : next(),
              ),
            tempDir,
            eventBus,
            runtime,
          ),
        );
        const second = yield* awaited(
          loadExtensionFromFactory(
            (msa) =>
              msa.registerToolRenderer((_toolName, next) => next() ?? { renderShell: "self" }),
            tempDir,
            eventBus,
            runtime,
          ),
        );
        const runner = new ExtensionRunner(
          [first, second],
          runtime,
          tempDir,
          sessionManager,
          modelRegistry,
        );

        expect(runner.resolveToolRenderers("a", () => undefined)).toEqual({ renderCall });
        expect(runner.resolveToolRenderers("b", () => undefined)).toEqual({ renderShell: "self" });
        expect(runner.resolveToolRenderers("b", () => ({ renderCall }))).toEqual({ renderCall });
      }),
    ));

  describe("boundary chaining", () => {
    it("chains shared draft proposals and preserves omitted result fields", () =>
      runTest(
        Effect.gen(function* () {
          const runtime = createExtensionRuntime();
          const eventBus = createEventBus();
          const observations: Array<{ entries: number; continuation: boolean; preview: number }> =
            [];
          const first = yield* awaited(
            loadExtensionFromFactory(
              (msa) => {
                msa.on("agent_before_settle", (event) => {
                  observations.push({
                    entries: event.entries.length,
                    continuation: event.continue,
                    preview: event.context.contextEntries.length,
                  });
                  event.entries.push({ type: "custom" as const, customType: "first", data: 1 });
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
                    entries: event.entries.length,
                    continuation: event.continue,
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
          const runner = new ExtensionRunner(
            [first, second],
            runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          const result = yield* awaited(
            runner.emitBoundary(
              { type: "agent_before_settle" as const, outcome: "completed" },
              (entries) => ({
                contextEntries: entries.map((entry, index) => ({
                  sourceEntry: {
                    type: "custom" as const,
                    id: `draft-${index}`,
                    parentId: null,
                    timestamp: "",
                    customType: entry.type,
                  },
                  messages: [],
                })),
                contextMessages: [],
                llmMessages: [],
                pendingMessages: [],
                canContinue: false,
              }),
            ),
          );

          expect(observations).toEqual([
            { entries: 0, continuation: false, preview: 0 },
            { entries: 1, continuation: true, preview: 1 },
          ]);
          expect(result.entries).toEqual([]);
          expect(result.continue).toBe(true);
        }),
      ));

    it("reports invalid boundary previews and lets later handlers repair the proposal", () =>
      runTest(
        Effect.gen(function* () {
          const runtime = createExtensionRuntime();
          let secondRan = false;
          const first = yield* awaited(
            loadExtensionFromFactory(
              (msa) => {
                msa.on("agent_before_settle", () => ({
                  entries: [
                    { type: "context_edit" as const, targetId: "missing", replacement: null },
                  ],
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
          const errors: string[] = [];
          runner.onError((error) => errors.push(error.error));

          const result = yield* awaited(
            runner.emitBoundary(
              { type: "agent_before_settle" as const, outcome: "completed" },
              (entries) => {
                if (entries.some((entry) => entry.type === "context_edit"))
                  throw new Error("Entry missing not found");
                return {
                  contextEntries: [],
                  contextMessages: [],
                  llmMessages: [],
                  pendingMessages: [],
                  canContinue: false,
                };
              },
            ),
          );

          expect(secondRan).toBe(true);
          expect(errors).toContain("Invalid boundary entries: Entry missing not found");
          expect(result.entries).toEqual([]);
          expect(result.valid).toBe(true);
        }),
      ));

    it("keeps shared mutations made before a handler throws", () =>
      runTest(
        Effect.gen(function* () {
          const runtime = createExtensionRuntime();
          const extension = yield* awaited(
            loadExtensionFromFactory(
              (msa) => {
                msa.on("agent_before_settle", (event) => {
                  event.entries.push({ type: "custom" as const, customType: "kept" });
                  throw new Error("boundary failed");
                });
              },
              tempDir,
              createEventBus(),
              runtime,
            ),
          );
          const runner = new ExtensionRunner(
            [extension],
            runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const errors: string[] = [];
          runner.onError((error) => errors.push(error.error));

          const result = yield* awaited(
            runner.emitBoundary(
              { type: "agent_before_settle" as const, outcome: "completed" },
              () => ({
                contextEntries: [],
                contextMessages: [],
                llmMessages: [],
                pendingMessages: [],
                canContinue: false,
              }),
            ),
          );

          expect(result.entries).toMatchObject([{ type: "custom" as const, customType: "kept" }]);
          expect(errors).toEqual(["boundary failed"]);
        }),
      ));
  });

  describe("tool_result chaining", () => {
    it("chains content modifications across handlers", () =>
      runTest(
        Effect.gen(function* () {
          const extCode1 = `
				export default function(msa) {
					msa.on("tool_result", async (event) => {
						return {
							content: [...event.content, { type: "text", text: "ext1" }],
						};
					});
				}
			`;
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
              type: "tool_result" as const,
              toolName: "my_tool",
              toolCallId: "call-1",
              input: {},
              content: [{ type: "text" as const, text: "base" }],
              details: { initial: true },
              isError: false,
            }),
          );

          expect(chained).toBeDefined();
          const chainedContent = chained?.content;
          expect(chainedContent).toBeDefined();
          expect(chainedContent![0]).toEqual({ type: "text" as const, text: "base" });
          expect(chainedContent).toHaveLength(3);
          const appendedText = chainedContent!
            .slice(1)
            .filter((item): item is { type: "text"; text: string } => item.type === "text")
            .map((item) => item.text);
          expect(appendedText.sort()).toEqual(["ext1", "ext2"]);
        }),
      ));

    it("preserves previous modifications when later handlers return partial patches", () =>
      runTest(
        Effect.gen(function* () {
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
              type: "tool_result" as const,
              toolName: "my_tool",
              toolCallId: "call-2",
              input: {},
              content: [{ type: "text" as const, text: "base" }],
              details: { initial: true },
              isError: false,
            }),
          );

          expect(chained).toEqual({
            content: [{ type: "text" as const, text: "first" }],
            details: { source: "ext1" },
            isError: true,
          });
        }),
      ));
  });

  describe("provider registration", () => {
    it("bindCore ignores invalid queued registrations and reports extension error", () =>
      runTest(
        Effect.gen(function* () {
          const runtime = createExtensionRuntime();
          runtime.registerProvider(
            "broken-provider",
            {
              streamSimple: (() => {
                throw new Error("should not run");
              }) as any,
            },
            "/tmp/broken-extension.ts",
          );

          const runner = new ExtensionRunner([], runtime, tempDir, sessionManager, modelRegistry);
          const errors: string[] = [];
          runner.onError((error) => errors.push(`${error.extensionPath}: ${error.error}`));

          expect(() => runner.bindCore(extensionActions, extensionContextActions)).not.toThrow();
          expect(errors).toEqual([
            '/tmp/broken-extension.ts: Provider broken-provider: "api" is required when registering streamSimple.',
          ]);
          yield* awaited(
            expect(modelRegistry.refresh()).resolves.toMatchObject({ aborted: false }),
          );
        }),
      ));

    it("pre-bind unregister removes all queued registrations for a provider", () => {
      const runtime = createExtensionRuntime();

      runtime.registerProvider("queued-provider", providerModelConfig);
      runtime.registerProvider("queued-provider", {
        ...providerModelConfig,
        models: [
          {
            id: "instant-model-2",
            name: "Instant Model 2",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      });
      expect(runtime.pendingProviderRegistrations).toHaveLength(2);

      runtime.unregisterProvider("queued-provider");
      expect(runtime.pendingProviderRegistrations).toHaveLength(0);
    });

    it("post-bind register and unregister take effect immediately", () => {
      const runtime = createExtensionRuntime();
      const runner = new ExtensionRunner([], runtime, tempDir, sessionManager, modelRegistry);

      runner.bindCore(extensionActions, extensionContextActions);
      expect(runtime.pendingProviderRegistrations).toHaveLength(0);

      runtime.registerProvider("instant-provider", providerModelConfig);
      expect(runtime.pendingProviderRegistrations).toHaveLength(0);
      expect(modelRegistry.find("instant-provider", "instant-model")?.cost.tiers).toEqual([
        {
          inputTokensAbove: 272000,
          input: 2,
          output: 3,
          cacheRead: 0.2,
          cacheWrite: 2.5,
        },
      ]);

      runtime.unregisterProvider("instant-provider");
      expect(modelRegistry.find("instant-provider", "instant-model")).toBeUndefined();
    });
  });

  describe("command context", () => {
    it("passes fork options through to the bound handler", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const runtime = createExtensionRuntime();
          const runner = new ExtensionRunner([], runtime, tempDir, sessionManager, modelRegistry);
          const fork = vi.fn(() => effectRunPromise(awaited({ cancelled: false })));

          runner.bindCommandContext({
            waitForIdle: () => effectRunPromise(Effect.sync(() => {})),
            newSession: () => effectRunPromise(awaited({ cancelled: false })),
            fork,
            navigateTree: () => effectRunPromise(awaited({ cancelled: false })),
            switchSession: () => effectRunPromise(awaited({ cancelled: false })),
            reload: () => effectRunPromise(Effect.sync(() => {})),
          });

          const commandContext = runner.createCommandContext();
          yield* awaited(commandContext.fork("entry-1"));
          expect(fork).toHaveBeenCalledWith("entry-1", undefined);

          yield* awaited(commandContext.fork("entry-2", { position: "at" }));
          expect(fork).toHaveBeenLastCalledWith("entry-2", { position: "at" });
        }),
      ));
  });

  describe("event subscriptions", () => {
    function loadSubscriptionExtension(factory: ExtensionFactory) {
      return runTest(
        Effect.gen(function* () {
          const runtime = createExtensionRuntime();
          const extension = yield* awaited(
            loadExtensionFromFactory(factory, tempDir, createEventBus(), runtime),
          );
          const runner = new ExtensionRunner(
            [extension],
            runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          return yield* awaited({ extension, runner });
        }),
      );
    }

    it("allows self-removal without skipping neighboring handlers", () =>
      runTest(
        Effect.gen(function* () {
          const calls: string[] = [];
          const { runner } = yield* awaited(
            loadSubscriptionExtension((msa) => {
              const unsubscribe = msa.on("agent_end", () => {
                calls.push("A");
                unsubscribe();
              });
              msa.on("agent_end", () => {
                calls.push("B");
              });
            }),
          );

          yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
          expect(calls).toEqual(["A", "B"]);

          yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
          expect(calls).toEqual(["A", "B", "B"]);
        }),
      ));

    it("removes duplicate registrations independently and cleans up the last handler", () =>
      runTest(
        Effect.gen(function* () {
          const calls: string[] = [];
          const unsubscribers: Array<() => void> = [];
          const { extension, runner } = yield* awaited(
            loadSubscriptionExtension((msa) => {
              const shared = () => {
                calls.push("shared");
              };
              unsubscribers.push(msa.on("agent_end", shared));
              unsubscribers.push(
                msa.on("agent_end", () => {
                  calls.push("B");
                }),
              );
              unsubscribers.push(msa.on("agent_end", shared));
            }),
          );
          const [stopFirst, stopB, stopSecond] = unsubscribers;
          if (stopFirst === undefined || stopB === undefined || stopSecond === undefined) {
            throw new Error("expected three unsubscribers");
          }

          stopSecond();
          stopSecond();
          yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
          expect(calls).toEqual(["shared", "B"]);

          stopFirst();
          yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
          expect(calls).toEqual(["shared", "B", "B"]);

          stopB();
          expect(extension.handlers.has("agent_end")).toBe(false);
        }),
      ));

    it("keeps removed pending handlers in the current dispatch", () =>
      runTest(
        Effect.gen(function* () {
          const calls: string[] = [];
          const { runner } = yield* awaited(
            loadSubscriptionExtension((msa) => {
              msa.on("agent_end", () => {
                calls.push("A");
                stopB();
              });
              const stopB = msa.on("agent_end", () => {
                calls.push("B");
              });
              msa.on("agent_end", () => {
                calls.push("C");
              });
            }),
          );

          yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
          expect(calls).toEqual(["A", "B", "C"]);
          yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
          expect(calls).toEqual(["A", "B", "C", "A", "C"]);
        }),
      ));

    it("defers registrations made during dispatch until the next dispatch", () =>
      runTest(
        Effect.gen(function* () {
          const calls: string[] = [];
          const { runner } = yield* awaited(
            loadSubscriptionExtension((msa) => {
              msa.on("agent_end", () => {
                calls.push("A");
                msa.on("agent_end", () => {
                  calls.push("C");
                });
              });
              msa.on("agent_end", () => {
                calls.push("B");
              });
            }),
          );

          yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
          expect(calls).toEqual(["A", "B"]);
          yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
          expect(calls).toEqual(["A", "B", "A", "B", "C"]);
        }),
      ));

    it("uses a fresh handler list for nested dispatches", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const calls: string[] = [];
          const { runner } = yield* awaited(
            loadSubscriptionExtension((msa) => {
              const stopA = msa.on("agent_end", () =>
                effectRunPromise(
                  Effect.gen(function* () {
                    calls.push("A");
                    stopA();
                    stopB();
                    msa.on("agent_end", () => {
                      calls.push("C");
                    });
                    yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
                  }),
                ),
              );
              const stopB = msa.on("agent_end", () => {
                calls.push("B");
              });
            }),
          );

          yield* awaited(runner.emit({ type: "agent_end" as const, messages: [] }));
          expect(calls).toEqual(["A", "C", "B"]);
        }),
      ));
  });

  describe("hasHandlers", () => {
    it("returns true when handlers exist for event type", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.on("tool_call", async () => undefined);
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "handler.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          expect(runner.hasHandlers("tool_call")).toBe(true);
          expect(runner.hasHandlers("agent_end")).toBe(false);
        }),
      ));
  });

  describe("before_provider_headers", () => {
    it("lets a handler mutate headers in place and preserves existing headers", () =>
      runTest(
        Effect.gen(function* () {
          const extCode = `
				export default function(msa) {
					msa.on("before_provider_headers", (event) => {
						event.headers["X-Turn-Index"] = "3";
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "headers.ts"), extCode);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );

          expect(runner.hasHandlers("before_provider_headers")).toBe(true);

          const headers = yield* awaited(
            runner.emitBeforeProviderHeaders({ "User-Agent": "kimchi/1.0" }),
          );
          expect(headers["X-Turn-Index"]).toBe("3");
          expect(headers["User-Agent"]).toBe("kimchi/1.0");
        }),
      ));

    it("isolates a throwing handler and still applies the others", () =>
      runTest(
        Effect.gen(function* () {
          const throwing = `
				export default function(msa) {
					msa.on("before_provider_headers", () => {
						throw new Error("header handler boom");
					});
				}
			`;
          const good = `
				export default function(msa) {
					msa.on("before_provider_headers", (event) => {
						event.headers["X-Good"] = "yes";
					});
				}
			`;
          yield* writeTextFile(joinPath(extensionsDir, "a-throwing.ts"), throwing);
          yield* writeTextFile(joinPath(extensionsDir, "b-good.ts"), good);

          const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
          const runner = new ExtensionRunner(
            result.extensions,
            result.runtime,
            tempDir,
            sessionManager,
            modelRegistry,
          );
          const errors: Array<{ event: string; error: string }> = [];
          runner.onError((err) => errors.push(err));

          const headers = yield* awaited(runner.emitBeforeProviderHeaders({ "User-Agent": "x" }));

          expect(headers["X-Good"]).toBe("yes");
          expect(headers["User-Agent"]).toBe("x");
          expect(errors).toHaveLength(1);
          expect(errors[0]?.event).toBe("before_provider_headers");
          expect(errors[0]?.error).toContain("header handler boom");
        }),
      ));
  });
});
