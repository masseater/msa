import testing from "@msa/testing";
import tui from "@msa/tui";
import { beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import TreeSelectorComponent from "../src/modes/interactive/components/tree-selector.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import treeSelector3Support from "./tree-selector-3-support.ts";
import treeSelectorSupport from "./tree-selector-support.ts";

const { initTheme } = themeModule;
const { setKeybindings } = tui;

const { CTRL_LEFT, CTRL_RIGHT, DOWN, buildBranchingTree } = treeSelector3Support;

const { assistantMessage, buildTree, userMessage } = treeSelectorSupport;

const { currentDate, currentTimeMillis } = testing;

beforeAll(() => {
  initTheme("dark");
});

beforeEach(() => {
  setKeybindings(new KeybindingsManager());
});

function toolCallOnlyAssistant(
  id: string,
  parentId: string | null,
): sessionManagerTypes.SessionMessageEntry {
  return {
    id,
    message: {
      api: "anthropic-messages" as const,
      content: [
        { arguments: { path: "test.ts" }, id: `tc-${id}`, name: "read", type: "toolCall" as const },
      ],
      model: "claude-sonnet-4",
      provider: "anthropic-api",
      role: "assistant",
      stopReason: "toolUse",
      timestamp: currentTimeMillis(),
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    },
    parentId,
    timestamp: currentDate().toISOString(),
    type: "message" as const,
  };
}

const foldAndNavigateOnNonActiveBranch = () => {
  const tree = buildBranchingTree();
  const selector = new TreeSelectorComponent(
    tree,
    "asst-4a",
    24,
    () => {},
    () => {},
  );
  const list = selector.getTreeList();

  let found = false;
  for (let i = 0; i < 20; i++) {
    selector.handleInput(DOWN);
    if (list.getSelectedNode()?.entry.id === "user-3b") {
      found = true;
      break;
    }
  }
  expect(found).toBe(true);

  selector.handleInput(CTRL_RIGHT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-4b");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3b");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3b");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");
};

const foldAndNavigateWithMultipleRoots = () => {
  const entries: sessionManagerTypes.SessionEntry[] = [
    userMessage("user-1", null, "first root"),
    assistantMessage("asst-1", "user-1", "response 1"),
    userMessage("user-2", null, "second root"),
    assistantMessage("asst-2", "user-2", "response 2"),
  ];
  const tree = buildTree(entries);
  const selector = new TreeSelectorComponent(
    tree,
    "asst-1",
    24,
    () => {},
    () => {},
  );
  const list = selector.getTreeList();

  expect(list.getSelectedNode()?.entry.id).toBe("asst-1");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");

  selector.handleInput(DOWN);
  expect(list.getSelectedNode()?.entry.id).toBe("user-2");

  selector.handleInput(CTRL_RIGHT);
  expect(list.getSelectedNode()?.entry.id).toBe("asst-2");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-2");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-2");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-2");
};

const foldingRootHidesDescendantsEvenWhenIntermediate = () => {
  const entries: sessionManagerTypes.SessionEntry[] = [
    userMessage("user-1", null, "hello"),
    toolCallOnlyAssistant("tool-asst-1", "user-1"),
    userMessage("user-2", "tool-asst-1", "follow up"),
    assistantMessage("asst-2", "user-2", "response"),
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

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");

  selector.handleInput(DOWN);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");
};

const searchResetsFoldState = () => {
  const tree = buildBranchingTree();
  const selector = new TreeSelectorComponent(
    tree,
    "asst-4a",
    24,
    () => {},
    () => {},
  );
  const list = selector.getTreeList();

  selector.handleInput(CTRL_LEFT);
  selector.handleInput(CTRL_LEFT);

  selector.handleInput(DOWN);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3b");

  selector.handleInput("b");
  selector.handleInput("\x1b");

  let currentId = "";
  for (let i = 0; i < 20; i++) {
    selector.handleInput(DOWN);
    currentId = list.getSelectedNode()?.entry.id ?? "";
    if (currentId === "user-3a") break;
  }
  expect(currentId).toBe("user-3a");

  selector.handleInput(DOWN);
  expect(list.getSelectedNode()?.entry.id).toBe("asst-3a");
};

const filterModeChangeResetsFoldState = () => {
  const tree = buildBranchingTree();
  const selector = new TreeSelectorComponent(
    tree,
    "asst-4a",
    24,
    () => {},
    () => {},
  );
  const list = selector.getTreeList();

  selector.handleInput(CTRL_LEFT);
  selector.handleInput(CTRL_LEFT);

  selector.handleInput("\x15");
  selector.handleInput("\x04");

  let currentId = "";
  for (let i = 0; i < 20; i++) {
    selector.handleInput(DOWN);
    currentId = list.getSelectedNode()?.entry.id ?? "";
    if (currentId === "user-3a") break;
  }
  expect(currentId).toBe("user-3a");

  selector.handleInput(DOWN);
  expect(list.getSelectedNode()?.entry.id).toBe("asst-3a");
};

describe("TreeSelectorComponent", () => {
  describe("branch navigation and folding with ctrl+arrow keys", () => {
    test("fold and navigate on non-active branch", foldAndNavigateOnNonActiveBranch);

    test("fold and navigate with multiple roots", foldAndNavigateWithMultipleRoots);

    test(
      "folding root hides descendants even when intermediate nodes are filtered out",
      foldingRootHidesDescendantsEvenWhenIntermediate,
    );
  });
});

describe("TreeSelectorComponent", () => {
  describe("branch navigation and folding with ctrl+arrow keys", () => {
    test("search resets fold state", searchResetsFoldState);

    test("filter mode change resets fold state", filterModeChangeResetsFoldState);
  });
});
