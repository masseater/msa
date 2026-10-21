import SplitPane from "./split-pane-class.ts";
import type splitPaneTypes from "./split-pane.types.ts";
import stack from "./stack.ts";

const { proportionalShares } = stack;

const WEIGHT = 1_000_000;

function rightWeightOf(share: number): number {
  return Number.isFinite(share) ? Math.round(Math.max(0, Math.min(1, share)) * WEIGHT) : 0;
}

function splitPaneWidths(width: number, share: number): splitPaneTypes.SplitPaneWidths {
  const total = Math.max(0, Math.floor(width));
  if (total === 0) return { divider: 0, left: 0, right: 0 };
  const rightWeight = rightWeightOf(share);
  const [left, right] = proportionalShares(total - 1, [WEIGHT - rightWeight, rightWeight]);
  return { divider: 1, left: left!, right: right! };
}

const splitPane = {
  SplitPane,
  WEIGHT,
  rightWeightOf,
  splitPaneWidths,
};

export default splitPane;
