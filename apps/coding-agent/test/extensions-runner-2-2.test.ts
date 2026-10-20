import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import ExtensionRunner from "../src/core/extensions/extension-runner.ts";
import loader from "../src/core/extensions/loader.ts";
import type keybindingsTypes from "../src/core/keybindings.types.ts";
import extensionsRunner2Support from "./extensions-runner-2-support.ts";
import extensionsRunnerEnv from "./extensions-runner-env.ts";

const { discoverAndLoadExtensions } = loader;
const { cleanupRunnerEnv, env, prepareRunnerEnv } = extensionsRunnerEnv;

const { defaultKeybindings } = extensionsRunner2Support;

const { awaited, joinPath, runTest, writeTextFile } = testing;

const blocksShortcutsForReservedActionsEvenWhen = () =>
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
      yield* writeTextFile(joinPath(env.extensionsDir, "rebound-reserved.ts"), extCode);

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
        "app.interrupt": "ctrl+x" as keybindingsTypes.KeyId,
      };
      const shortcuts = runner.getShortcuts(keybindings);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
      expect(shortcuts.has("ctrl+x")).toBe(false);

      warnSpy.mockRestore();
    }),
  );

const blocksShortcutsWhenReservedKeyIsAlso = () =>
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
      yield* writeTextFile(joinPath(env.extensionsDir, "shared-reserved.ts"), extCode);

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
      expect(shortcuts.has("ctrl+p")).toBe(false);

      warnSpy.mockRestore();
    }),
  );

const blocksShortcutsWhenReservedActionHasMultiple = () =>
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
      yield* writeTextFile(joinPath(env.extensionsDir, "multi-reserved.ts"), extCode);

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
        "app.clear": ["ctrl+x", "ctrl+y"] as keybindingsTypes.KeyId[],
      };
      const shortcuts = runner.getShortcuts(keybindings);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
      expect(shortcuts.has("ctrl+y")).toBe(false);

      warnSpy.mockRestore();
    }),
  );

const warnsButAllowsWhenNonReservedAction = () =>
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
      yield* writeTextFile(joinPath(env.extensionsDir, "multi-non-reserved.ts"), extCode);

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
        "app.clipboard.pasteImage": ["ctrl+x", "ctrl+y"] as keybindingsTypes.KeyId[],
      };
      const shortcuts = runner.getShortcuts(keybindings);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("built-in shortcut for app.clipboard.pasteImage"),
      );
      expect(shortcuts.has("ctrl+y")).toBe(true);

      warnSpy.mockRestore();
    }),
  );

const warnsWhenTwoExtensionsRegisterSameShortcut = () =>
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
      yield* writeTextFile(joinPath(env.extensionsDir, "ext1.ts"), extCode1);
      yield* writeTextFile(joinPath(env.extensionsDir, "ext2.ts"), extCode2);

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

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("shortcut conflict"));

      expect(shortcuts.has("ctrl+shift+x")).toBe(true);

      warnSpy.mockRestore();
    }),
  );

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(prepareRunnerEnv));

  afterEach(cleanupRunnerEnv);

  describe("shortcut conflicts", () => {
    it(
      "blocks shortcuts for reserved actions even when rebound",
      blocksShortcutsForReservedActionsEvenWhen,
    );

    it(
      "blocks shortcuts when reserved key is also bound to non-reserved actions",
      blocksShortcutsWhenReservedKeyIsAlso,
    );

    it(
      "blocks shortcuts when reserved action has multiple keys",
      blocksShortcutsWhenReservedActionHasMultiple,
    );
  });
});

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(prepareRunnerEnv));

  afterEach(cleanupRunnerEnv);

  describe("shortcut conflicts", () => {
    it(
      "warns but allows when non-reserved action has multiple keys",
      warnsButAllowsWhenNonReservedAction,
    );

    it(
      "warns when two extensions register same shortcut",
      warnsWhenTwoExtensionsRegisterSameShortcut,
    );
  });
});
