import { type Component, SelectList } from "@msa/tui";

import { BOLD, DIM, MAGENTA, RESET, YELLOW } from "./colors.ts";

export class SelectDialog implements Component {
  private list: SelectList;
  private title: string;
  onSelect?: (value: string) => void;
  onCancel?: () => void;

  constructor(title: string, options: string[]) {
    this.title = title;
    const items = options.map((o) => ({ value: o, label: o }));
    this.list = new SelectList(items, Math.min(items.length, 8), {
      selectedPrefix: (t) => `${MAGENTA}${t}${RESET}`,
      selectedText: (t) => `${MAGENTA}${t}${RESET}`,
      description: (t) => `${DIM}${t}${RESET}`,
      scrollInfo: (t) => `${DIM}${t}${RESET}`,
      noMatch: (t) => `${YELLOW}${t}${RESET}`,
    });
    this.list.onSelect = (item) => this.onSelect?.(item.value);
    this.list.onCancel = () => this.onCancel?.();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    return [
      `${MAGENTA}${BOLD}${this.title}${RESET}`,
      ...this.list.render(width),
      `${DIM}Up/Down, Enter to select, Esc to cancel${RESET}`,
    ];
  }
}
