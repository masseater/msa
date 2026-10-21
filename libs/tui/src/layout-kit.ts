import ansiSequences from "./ansi-sequences.ts";
import ansiTracker from "./ansi-tracker.ts";
import layoutTree from "./layout-tree.ts";

const layoutKit: {
  readonly ansiSequences: typeof ansiSequences;
  readonly ansiTracker: typeof ansiTracker;
  readonly layoutTree: typeof layoutTree;
} = {
  ansiSequences,
  ansiTracker,
  layoutTree,
};

export default layoutKit;
