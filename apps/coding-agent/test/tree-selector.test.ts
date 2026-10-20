import { stripVTControlCharacters } from "node:util";

import testing from "@msa/testing";
import { setKeybindings, visibleWidth } from "@msa/tui";
import { beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { ModelChangeEntry, SessionEntry } from "../src/core/session-manager.ts";
import { TreeSelectorComponent } from "../src/modes/interactive/components/tree-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import treeSelectorSupport from "./tree-selector-support.ts";

const { assistantMessage, buildTree, userMessage } = treeSelectorSupport;

const { currentDate } = testing;

beforeAll(() => {
  initTheme("dark");
});

beforeEach(() => {
  setKeybindings(new KeybindingsManager());
});

function modelChange(id: string, parentId: string | null): ModelChangeEntry {
  return {
    id,
    modelId: "claude-sonnet-4",
    parentId,
    provider: "anthropic-api",
    timestamp: currentDate().toISOString(),
    type: "model_change" as const,
  };
}

const focusesNearestVisibleAncestorWhenCurrentleafidIs = () => {
  const entries = [
    userMessage("user-1", null, "hello"),
    assistantMessage("asst-1", "user-1", "hi"),
    userMessage("user-2", "asst-1", "active branch"),
    modelChange("model-1", "user-2"),
    userMessage("user-3", "asst-1", "sibling branch"),
  ];
  const tree = buildTree(entries);

  const selector = new TreeSelectorComponent(
    tree,
    "model-1",
    24,
    () => {},
    () => {},
  );

  const list = selector.getTreeList();

  expect(list.getSelectedNode()?.entry.id).toBe("user-2");
};

const hidesContextEditsByDefaultAndLabels = () => {
  const entries: SessionEntry[] = [
    userMessage("user-1", null, "hello"),
    assistantMessage("asst-1", "user-1", "hi"),
    {
      id: "edit-1",
      parentId: "asst-1",
      replacement: null,
      targetId: "asst-1",
      timestamp: currentDate().toISOString(),
      type: "context_edit" as const,
    },
  ];
  const tree = buildTree(entries);
  const defaultSelector = new TreeSelectorComponent(
    tree,
    "edit-1",
    24,
    () => {},
    () => {},
  );
  expect(defaultSelector.getTreeList().getSelectedNode()?.entry.id).toBe("asst-1");

  const allSelector = new TreeSelectorComponent(
    tree,
    "edit-1",
    24,
    () => {},
    () => {},
    undefined,
    undefined,
    "all",
  );
  const rendered = allSelector.getTreeList().render(200).map(stripVTControlCharacters).join("\n");
  expect(rendered).toContain("[context omit: asst-1]");
};

const focusesNearestVisibleAncestorWhenCurrentleafidIs2 = () => {
  const entries = [
    userMessage("user-1", null, "hello"),
    assistantMessage("asst-1", "user-1", "hi"),
    userMessage("user-2", "asst-1", "active branch"),
    {
      id: "thinking-1",
      parentId: "user-2",
      thinkingLevel: "high",
      timestamp: currentDate().toISOString(),
      type: "thinking_level_change" as const,
    },
    userMessage("user-3", "asst-1", "sibling branch"),
  ];
  const tree = buildTree(entries);

  const selector = new TreeSelectorComponent(
    tree,
    "thinking-1",
    24,
    () => {},
    () => {},
  );

  const list = selector.getTreeList();
  expect(list.getSelectedNode()?.entry.id).toBe("user-2");
};

const switchesToNearestVisibleUserMessageWhen = () => {
  const entries = [
    userMessage("user-1", null, "hello"),
    assistantMessage("asst-1", "user-1", "hi"),
    userMessage("user-2", "asst-1", "active branch"),
    assistantMessage("asst-2", "user-2", "response"),
    userMessage("user-3", "asst-1", "sibling branch"),
  ];
  const tree = buildTree(entries);

  const selector = new TreeSelectorComponent(
    tree,
    "asst-2",
    24,
    () => {},
    () => {},
  );

  const list = selector.getTreeList();
  expect(list.getSelectedNode()?.entry.id).toBe("asst-2");

  selector.handleInput("\x15");

  expect(list.getSelectedNode()?.entry.id).toBe("user-2");
};

const returnsToNearestVisibleAncestorWhenSwitching = () => {
  const entries = [
    userMessage("user-1", null, "hello"),
    assistantMessage("asst-1", "user-1", "hi"),
    userMessage("user-2", "asst-1", "active branch"),
    assistantMessage("asst-2", "user-2", "response"),
    userMessage("user-3", "asst-1", "sibling branch"),
  ];
  const tree = buildTree(entries);

  const selector = new TreeSelectorComponent(
    tree,
    "asst-2",
    24,
    () => {},
    () => {},
  );

  const list = selector.getTreeList();
  expect(list.getSelectedNode()?.entry.id).toBe("asst-2");

  selector.handleInput("\x15");
  expect(list.getSelectedNode()?.entry.id).toBe("user-2");

  selector.handleInput("\x04");
  expect(list.getSelectedNode()?.entry.id).toBe("user-2");
};

const rendersSemanticHelpRowsWithoutTruncatingNarrow = () => {
  const entries = [
    userMessage("user-1", null, "hello"),
    assistantMessage("asst-1", "user-1", "hi"),
  ];
  const tree = buildTree(entries);
  const selector = new TreeSelectorComponent(
    tree,
    "asst-1",
    24,
    () => {},
    () => {},
  );

  const plainLines = selector.render(30).map(stripVTControlCharacters);
  const plain = plainLines.join("\n");
  expect(plain).toContain("branch");
  expect(plain).toContain("copy");
  expect(plain).toContain("filters");
  expect(plain).toContain("cycle");
  expect(plain).toContain("label time");
  expect(plain).not.toContain("...");
  expect(plainLines.every((line) => visibleWidth(line) <= 30)).toBe(true);
};

const copiesTheFullSelectedMessageWithCtrl = () => {
  const message = `${"long message ".repeat(30)}\nsecond line`;
  const tree = buildTree([
    userMessage("user-1", null, "hello"),
    assistantMessage("asst-1", "user-1", message),
  ]);
  const selector = new TreeSelectorComponent(
    tree,
    "asst-1",
    24,
    () => {},
    () => {},
  );
  let copied: string | undefined;
  selector.onCopy = (text) => {
    copied = text;
  };

  selector.handleInput("\x18");

  expect(copied).toBe(message);
};

describe("TreeSelectorComponent", () => {
  describe("initial selection with metadata entries", () => {
    test(
      "focuses nearest visible ancestor when currentLeafId is a model_change with sibling branch",
      focusesNearestVisibleAncestorWhenCurrentleafidIs,
    );

    test(
      "hides context edits by default and labels them in all mode",
      hidesContextEditsByDefaultAndLabels,
    );

    test(
      "focuses nearest visible ancestor when currentLeafId is a thinking_level_change entry",
      focusesNearestVisibleAncestorWhenCurrentleafidIs2,
    );
  });

  describe("filter switching with parent traversal", () => {
    test(
      "switches to nearest visible user message when changing to user-only filter",
      switchesToNearestVisibleUserMessageWhen,
    );

    test(
      "returns to nearest visible ancestor when switching back to default filter",
      returnsToNearestVisibleAncestorWhenSwitching,
    );
  });

  describe("help", () => {
    test(
      "renders semantic help rows without truncating narrow terminal controls",
      rendersSemanticHelpRowsWithoutTruncatingNarrow,
    );
  });

  describe("copy", () => {
    test("copies the full selected message with ctrl+x", copiesTheFullSelectedMessageWithCtrl);
  });
});
