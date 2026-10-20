import tui from "@msa/tui";
import { beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { TreeSelectorComponent } from "../src/modes/interactive/components/tree-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import treeSelector3Support from "./tree-selector-3-support.ts";

const { setKeybindings } = tui;

const { CTRL_LEFT, CTRL_RIGHT, DOWN, buildBranchingTree } = treeSelector3Support;

beforeAll(() => {
  initTheme("dark");
});

beforeEach(() => {
  setKeybindings(new KeybindingsManager());
});

const UP = "\x1b[A";

const ALT_LEFT = "\x1b[1;3D";

const ALT_RIGHT = "\x1b[1;3C";

const ctrlRightUnfoldsAFoldedNodeThen = () => {
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
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(DOWN);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3b");

  selector.handleInput(UP);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(CTRL_RIGHT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(DOWN);
  expect(list.getSelectedNode()?.entry.id).toBe("asst-3a");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(CTRL_RIGHT);
  expect(list.getSelectedNode()?.entry.id).toBe("asst-4a");
};

const altLeftRightAreAliasesForFold = () => {
  const tree = buildBranchingTree();
  const selector = new TreeSelectorComponent(
    tree,
    "asst-4a",
    24,
    () => {},
    () => {},
  );
  const list = selector.getTreeList();

  selector.handleInput(ALT_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(ALT_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(ALT_RIGHT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(ALT_RIGHT);
  expect(list.getSelectedNode()?.entry.id).toBe("asst-4a");
};

const foldingRootHidesEntireSubtreeNestedFold = () => {
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
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");

  selector.handleInput(CTRL_LEFT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");

  selector.handleInput(DOWN);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");

  selector.handleInput(CTRL_RIGHT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-1");

  selector.handleInput(CTRL_RIGHT);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3a");

  selector.handleInput(DOWN);
  expect(list.getSelectedNode()?.entry.id).toBe("user-3b");
};

describe("TreeSelectorComponent", () => {
  describe("branch navigation and folding with ctrl+arrow keys", () => {
    test(
      "ctrl+right unfolds a folded node, then does segment jump when unfolded",
      ctrlRightUnfoldsAFoldedNodeThen,
    );

    test(
      "alt+left/right are aliases for fold and unfold navigation",
      altLeftRightAreAliasesForFold,
    );

    test(
      "folding root hides entire subtree, nested fold preserved on unfold",
      foldingRootHidesEntireSubtreeNestedFold,
    );
  });
});
