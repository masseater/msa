import { setKeybindings } from "@msa/tui";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import type { ExtensionShortcut } from "../src/core/extensions/index.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { keyDisplayText } from "../src/modes/interactive/components/keybinding-hints.ts";
import { formatHotkeysMarkdown } from "../src/modes/interactive/hotkeys.ts";

const documentsTheActiveKeybindingsAndTypedPrefixes = () => {
  const markdown = formatHotkeysMarkdown(new Map());

  expect(markdown).toContain(`| \`${keyDisplayText("tui.input.submit")}\` | Send message |`);
  expect(markdown).toContain(
    `| \`${keyDisplayText("app.model.cycleForward")}\` / \`${keyDisplayText("app.model.cycleBackward")}\` | Cycle models |`,
  );
  expect(markdown).toContain("| `!!` | Run bash command (excluded from context) |");
  expect(markdown).not.toContain("**Extensions**");
};

const listsExtensionShortcutsFallingBackToThe = () => {
  const shortcuts = new Map<string, ExtensionShortcut>([
    [
      "ctrl+k",
      { description: "Open palette", extensionPath: "/ext/palette.ts" } as ExtensionShortcut,
    ],
    ["ctrl+j", { extensionPath: "/ext/jump.ts" } as ExtensionShortcut],
  ]);

  const extensions = formatHotkeysMarkdown(shortcuts).split("**Extensions**")[1];

  expect(extensions).toContain("| Open palette |");
  expect(extensions).toContain("| /ext/jump.ts |");
};

describe("formatHotkeysMarkdown", () => {
  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  it(
    "documents the active keybindings and typed prefixes",
    documentsTheActiveKeybindingsAndTypedPrefixes,
  );

  it(
    "lists extension shortcuts, falling back to the extension path",
    listsExtensionShortcutsFallingBackToThe,
  );
});
