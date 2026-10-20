import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { type KeyId } from "../src/core/keybindings.ts";
import extensionsRunner2Support from "./extensions-runner-2-support.ts";
import extensionsRunnerEnv from "./extensions-runner-env.ts";

const { cleanupRunnerEnv, env, prepareRunnerEnv } = extensionsRunnerEnv;

const { defaultKeybindings } = extensionsRunner2Support;

const { awaited, joinPath, runTest, writeTextFile } = testing;

const warnsWhenExtensionShortcutConflictsWithBuilt = () =>
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
      yield* writeTextFile(joinPath(env.extensionsDir, "conflict.ts"), extCode);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      const shortcuts = runner.getShortcuts(defaultKeybindings);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
      expect(shortcuts.has("ctrl+c")).toBe(false);

      warnSpy.mockRestore();
    }),
  );

const allowsAShortcutWhenTheReservedSet = () =>
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
      yield* writeTextFile(joinPath(env.extensionsDir, "rebinding.ts"), extCode);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      const keybindings = {
        ...defaultKeybindings,
        "app.model.cycleForward": "ctrl+n" as KeyId,
      };
      const shortcuts = runner.getShortcuts(keybindings);

      expect(shortcuts.has("ctrl+p")).toBe(true);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));

      warnSpy.mockRestore();
    }),
  );

const warnsButAllowsWhenExtensionUsesNon = () =>
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
      yield* writeTextFile(joinPath(env.extensionsDir, "non-reserved.ts"), extCode);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      const shortcuts = runner.getShortcuts(defaultKeybindings);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("built-in shortcut for app.clipboard.pasteImage"),
      );
      expect(shortcuts.has(pasteImageKey as KeyId)).toBe(true);

      warnSpy.mockRestore();
    }),
  );

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(prepareRunnerEnv));

  afterEach(cleanupRunnerEnv);

  describe("shortcut conflicts", () => {
    it(
      "warns when extension shortcut conflicts with built-in",
      warnsWhenExtensionShortcutConflictsWithBuilt,
    );

    it(
      "allows a shortcut when the reserved set no longer contains the default key",
      allowsAShortcutWhenTheReservedSet,
    );

    it(
      "warns but allows when extension uses non-reserved built-in shortcut",
      warnsButAllowsWhenExtensionUsesNon,
    );
  });
});
