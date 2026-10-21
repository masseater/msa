import diffModule from "../../../modes/interactive/components/diff.ts";
import keybindingHints from "../../../modes/interactive/components/keybinding-hints.ts";

const { renderDiff } = diffModule;
const { expandHint } = keybindingHints;

const summarizeDiff = (diff: string): string => {
  const rows = diff.split("\n");
  const added = rows.filter((row) => /^\+\s*\d/u.test(row)).length;
  const removed = rows.filter((row) => /^-\s*\d/u.test(row)).length;
  return `+${added} -${removed} lines`;
};

const renderDiffBody = (diff: string, expanded: boolean, filePath?: string): string =>
  expanded ? renderDiff(diff, { filePath }) : expandHint(summarizeDiff(diff));

const editDiffView = { renderDiffBody };

export default editDiffView;
