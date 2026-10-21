import testing from "@msa/testing";
import tui from "@msa/tui";
import { beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import TreeSelectorComponent from "../src/modes/interactive/components/tree-selector.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import treeSelectorSupport from "./tree-selector-support.ts";

const { initTheme } = themeModule;
const { setKeybindings } = tui;

const { assistantMessage, buildTree, userMessage } = treeSelectorSupport;

const { dateFromMillis } = testing;

beforeAll(() => {
  initTheme("dark");
});

beforeEach(() => {
  setKeybindings(new KeybindingsManager());
});

const togglesLabelTimestampsForLabeledNodes = () => {
  const entries = [
    userMessage("user-1", null, "hello"),
    assistantMessage("asst-1", "user-1", "hi"),
  ];
  const tree = buildTree(entries);
  const labelDate = dateFromMillis(Date.parse("2026-03-28T14:32:00"));
  tree[0]!.label = "checkpoint";
  tree[0]!.labelTimestamp = labelDate.toISOString();

  const selector = new TreeSelectorComponent(
    tree,
    "asst-1",
    24,
    () => {},
    () => {},
  );

  const list = selector.getTreeList();
  let render = list.render(200).join("\n");
  expect(render).toContain("[checkpoint]");
  expect(render).not.toContain("3/28 14:32");
  expect(render).not.toContain("[+label time]");

  selector.handleInput("T");

  render = list.render(200).join("\n");
  expect(render).toContain("3/28 14:32");
  expect(render).toContain("[+label time]");
};

const preservesSelectionWhenSwitchingToEmptyLabeled = () => {
  const entries = [
    userMessage("user-1", null, "hello"),
    assistantMessage("asst-1", "user-1", "hi"),
    userMessage("user-2", "asst-1", "bye"),
    assistantMessage("asst-2", "user-2", "goodbye"),
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

  selector.handleInput("\x0c");

  expect(list.getSelectedNode()).toBeUndefined();

  selector.handleInput("\x04");

  expect(list.getSelectedNode()?.entry.id).toBe("asst-2");
};

const preservesSelectionThroughMultipleEmptyFilterSwitches = () => {
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

  const list = selector.getTreeList();
  expect(list.getSelectedNode()?.entry.id).toBe("asst-1");

  selector.handleInput("\x0c");
  expect(list.getSelectedNode()).toBeUndefined();

  selector.handleInput("\x0c");
  expect(list.getSelectedNode()?.entry.id).toBe("asst-1");

  selector.handleInput("\x0c");
  expect(list.getSelectedNode()).toBeUndefined();

  selector.handleInput("\x04");
  expect(list.getSelectedNode()?.entry.id).toBe("asst-1");
};

describe("TreeSelectorComponent", () => {
  describe("label timestamps", () => {
    test("toggles label timestamps for labeled nodes", togglesLabelTimestampsForLabeledNodes);
  });

  describe("empty filter preservation", () => {
    test(
      "preserves selection when switching to empty labeled filter and back",
      preservesSelectionWhenSwitchingToEmptyLabeled,
    );

    test(
      "preserves selection through multiple empty filter switches",
      preservesSelectionThroughMultipleEmptyFilterSwitches,
    );
  });
});
