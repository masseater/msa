import {
  LAYOUT_NODE,
  type LayoutViewport,
  type StackLayoutEntry,
  type StackLayoutNode,
} from "../layout-node.ts";
import { type Component, compositeTuiLine } from "../tui-component.ts";
import { allocateStackSizes, proportionalShares, visibleStackEntries } from "./stack.ts";

export interface SplitPaneOptions {
  left: Component;
  right: Component;
  divider: Component;
  rightShare: () => number;
  minRightWidth: number;
  minLeftWidth?: number;
  visible?: () => boolean;
}

export interface SplitPaneWidths {
  left: number;
  divider: number;
  right: number;
}

const WEIGHT = 1_000_000;

function rightWeightOf(share: number): number {
  return Number.isFinite(share) ? Math.round(Math.max(0, Math.min(1, share)) * WEIGHT) : 0;
}

export function splitPaneWidths(width: number, share: number): SplitPaneWidths {
  const total = Math.max(0, Math.floor(width));
  if (total === 0) return { left: 0, divider: 0, right: 0 };
  const rightWeight = rightWeightOf(share);
  const [left, right] = proportionalShares(total - 1, [WEIGHT - rightWeight, rightWeight]);
  return { left: left!, divider: 1, right: right! };
}

export class SplitPane implements Component {
  private readonly options: SplitPaneOptions;

  constructor(options: SplitPaneOptions) {
    this.options = options;
  }

  private entries(): StackLayoutEntry[] {
    const rightWeight = rightWeightOf(this.options.rightShare());
    const visible = (viewport: LayoutViewport) => {
      if (!(this.options.visible?.() ?? true)) return false;
      const widths = splitPaneWidths(viewport.width, this.options.rightShare());
      return (
        widths.right > 0 &&
        widths.right >= this.options.minRightWidth &&
        widths.left >= (this.options.minLeftWidth ?? 0)
      );
    };
    return [
      { component: this.options.left, basis: 0, grow: WEIGHT - rightWeight, shrink: 1 },
      { component: this.options.divider, basis: 1, grow: 0, shrink: 0, visible },
      { component: this.options.right, basis: 0, grow: rightWeight, shrink: 1, visible },
    ];
  }

  [LAYOUT_NODE](): StackLayoutNode {
    return { type: "hstack", entries: this.entries(), gap: 0, align: "stretch" };
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const entries = visibleStackEntries(this.entries(), {
      width: safeWidth,
      height: Number.MAX_SAFE_INTEGER,
    });
    if (entries.length === 0) return [];
    const widths = allocateStackSizes(
      entries,
      entries.map(() => 0),
      safeWidth,
      0,
    );
    const rendered = entries.map((entry, index) =>
      widths[index] === 0 ? [] : entry.component.render(widths[index]!),
    );
    const height = rendered.reduce((max, lines) => Math.max(max, lines.length), 0);
    const result = Array.from({ length: height }, () => "");
    let x = 0;
    for (let index = 0; index < rendered.length; index++) {
      const lines = rendered[index]!;
      for (let row = 0; row < lines.length; row++) {
        result[row] = compositeTuiLine(result[row]!, lines[row]!, x, widths[index]!, safeWidth);
      }
      x += widths[index]!;
    }
    return result;
  }

  invalidate(): void {
    this.options.left.invalidate();
    this.options.right.invalidate();
    this.options.divider.invalidate();
  }
}
