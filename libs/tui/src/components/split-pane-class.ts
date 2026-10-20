import layoutNode from "../layout-node.ts";
import type layoutNodeTypes from "../layout-node.types.ts";
import tuiComponent from "../tui-component.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import splitPaneModule from "./split-pane.ts";
import type splitPaneTypes from "./split-pane.types.ts";
import stack from "./stack.ts";

const { allocateStackSizes, visibleStackEntries } = stack;
const { LAYOUT_NODE } = layoutNode;
const { compositeTuiLine } = tuiComponent;

export default class SplitPane implements tuiComponentTypes.Component {
  private readonly options: splitPaneTypes.SplitPaneOptions;

  constructor(options: splitPaneTypes.SplitPaneOptions) {
    this.options = options;
  }

  private entries(): layoutNodeTypes.StackLayoutEntry[] {
    const rightWeight = splitPaneModule.rightWeightOf(this.options.rightShare());
    const visible = (viewport: layoutNodeTypes.LayoutViewport) => {
      if (!(this.options.visible?.() ?? true)) return false;
      const widths = splitPaneModule.splitPaneWidths(viewport.width, this.options.rightShare());
      return (
        widths.right > 0 &&
        widths.right >= this.options.minRightWidth &&
        widths.left >= (this.options.minLeftWidth ?? 0)
      );
    };
    return [
      {
        basis: 0,
        component: this.options.left,
        grow: splitPaneModule.WEIGHT - rightWeight,
        shrink: 1,
      },
      { basis: 1, component: this.options.divider, grow: 0, shrink: 0, visible },
      { basis: 0, component: this.options.right, grow: rightWeight, shrink: 1, visible },
    ];
  }

  [LAYOUT_NODE](): layoutNodeTypes.StackLayoutNode {
    return { align: "stretch", entries: this.entries(), gap: 0, type: "hstack" };
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const entries = visibleStackEntries(this.entries(), {
      height: Number.MAX_SAFE_INTEGER,
      width: safeWidth,
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
