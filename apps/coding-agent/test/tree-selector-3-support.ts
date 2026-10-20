import type { SessionEntry } from "../src/core/session-manager.ts";
import treeSelectorSupport from "./tree-selector-support.ts";

const { assistantMessage, buildTree, userMessage } = treeSelectorSupport;

const DOWN = "\x1b[B";

const CTRL_LEFT = "\x1b[1;5D";

const CTRL_RIGHT = "\x1b[1;5C";

function buildBranchingTree() {
  const entries: SessionEntry[] = [
    userMessage("user-1", null, "first message"),
    assistantMessage("asst-1", "user-1", "response 1"),
    userMessage("user-2", "asst-1", "second message"),
    assistantMessage("asst-2", "user-2", "response 2"),

    userMessage("user-3a", "asst-2", "branch A start"),
    assistantMessage("asst-3a", "user-3a", "branch A response"),
    userMessage("user-4a", "asst-3a", "branch A deep"),
    assistantMessage("asst-4a", "user-4a", "branch A leaf"),

    userMessage("user-3b", "asst-2", "branch B start"),
    assistantMessage("asst-3b", "user-3b", "branch B response"),
    userMessage("user-4b", "asst-3b", "branch B deep"),
  ];
  return buildTree(entries);
}

const treeSelector3Support = {
  CTRL_LEFT,
  CTRL_RIGHT,
  DOWN,
  buildBranchingTree,
};

export default treeSelector3Support;
