import { SelectList } from "../src/components/select-list.ts";
import { Container } from "../src/tui.ts";
import { selectTheme } from "./mouse-components-helpers.ts";

export class SubmenuHost extends Container {
  readonly list = new SelectList(
    [
      { value: "first", label: "First" },
      { value: "second", label: "Second" },
    ],
    5,
    selectTheme,
  );

  constructor(done: (value?: string) => void) {
    super();
    this.list.onSelect = (item) => done(item.value);
    this.list.onCancel = () => done();
    this.addChild(this.list);
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }
}
