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

type KeybindingOverrides = Partial<
  Record<string, keybindingsTypes.KeyId | keybindingsTypes.KeyId[]>
>;

interface ShortcutCase {
  readonly allowed: boolean;
  readonly extensions: readonly { readonly description: string; readonly file: string }[];
  readonly key: keybindingsTypes.KeyId;
  readonly name: string;
  readonly overrides: KeybindingOverrides;
  readonly warning: string;
}

const shortcutCases: readonly ShortcutCase[] = [
  {
    allowed: false,
    extensions: [{ description: "Conflicts with rebound reserved", file: "rebound-reserved.ts" }],
    key: "ctrl+x",
    name: "blocks shortcuts for reserved actions even when rebound",
    overrides: { "app.interrupt": "ctrl+x" as keybindingsTypes.KeyId },
    warning: "conflicts with built-in",
  },
  {
    allowed: false,
    extensions: [
      { description: "Conflicts with shared reserved default", file: "shared-reserved.ts" },
    ],
    key: "ctrl+p",
    name: "blocks shortcuts when reserved key is also bound to non-reserved actions",
    overrides: {},
    warning: "conflicts with built-in",
  },
  {
    allowed: false,
    extensions: [{ description: "Conflicts with multi-key reserved", file: "multi-reserved.ts" }],
    key: "ctrl+y",
    name: "blocks shortcuts when reserved action has multiple keys",
    overrides: { "app.clear": ["ctrl+x", "ctrl+y"] as keybindingsTypes.KeyId[] },
    warning: "conflicts with built-in",
  },
  {
    allowed: true,
    extensions: [
      { description: "Overrides multi-key non-reserved", file: "multi-non-reserved.ts" },
    ],
    key: "ctrl+y",
    name: "warns but allows when non-reserved action has multiple keys",
    overrides: { "app.clipboard.pasteImage": ["ctrl+x", "ctrl+y"] as keybindingsTypes.KeyId[] },
    warning: "built-in shortcut for app.clipboard.pasteImage",
  },
  {
    allowed: true,
    extensions: [
      { description: "First extension", file: "ext1.ts" },
      { description: "Second extension", file: "ext2.ts" },
    ],
    key: "ctrl+shift+x",
    name: "warns when two extensions register same shortcut",
    overrides: {},
    warning: "shortcut conflict",
  },
];

const shortcutConflict = ({ allowed, extensions, key, overrides, warning }: ShortcutCase) =>
  Effect.gen(function* () {
    for (const { description, file } of extensions) {
      yield* writeTextFile(
        joinPath(env.extensionsDir, file),
        `export default function(msa) {
  msa.registerShortcut("${key}", {
    description: "${description}",
    handler: async () => {},
  });
}
`,
      );
    }

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
    const runner = new ExtensionRunner(
      result.extensions,
      result.runtime,
      env.tempDir,
      env.sessionManager,
      env.modelRegistry,
    );
    const shortcuts = runner.getShortcuts({ ...defaultKeybindings, ...overrides });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(warning));
    expect(shortcuts.has(key)).toBe(allowed);

    warnSpy.mockRestore();
  });

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(prepareRunnerEnv));

  afterEach(cleanupRunnerEnv);

  describe("shortcut conflicts", () => {
    it.each(shortcutCases)("$name", (testCase) => runTest(shortcutConflict(testCase)));
  });
});
