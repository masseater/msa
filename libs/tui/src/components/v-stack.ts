import stack from "./stack.ts";
import type stackTypes from "./stack.types.ts";

const { allocateStackSizes, visibleStackEntries } = stack;

export default class VStack extends stack.Stack {
  protected readonly layoutType = "vstack" as const;

  constructor(children: stackTypes.StackChild[] = [], options: stackTypes.StackOptions = {}) {
    super(children, options);
  }

  override render(width: number): string[] {
    const viewport = { height: Number.MAX_SAFE_INTEGER, width: Math.max(1, width) };
    const entries = visibleStackEntries(this.entries, viewport);
    const rendered = entries.map((entry) => entry.component.render(viewport.width));
    const sizes = allocateStackSizes(
      entries,
      rendered.map((lines) => lines.length),
      undefined,
      this.gap,
    );
    const lines: string[] = [];
    for (let index = 0; index < entries.length; index++) {
      if (index > 0) {
        for (let gap = 0; gap < this.gap; gap++) lines.push("");
      }
      const childLines = rendered[index]!.slice(0, sizes[index]);
      lines.push(...childLines);
      for (let padding = childLines.length; padding < sizes[index]!; padding++) lines.push("");
    }
    return lines;
  }
}
