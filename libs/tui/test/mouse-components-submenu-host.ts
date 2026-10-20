import { SelectList } from "../src/components/select-list.ts";
import { Container } from "../src/tui-component.ts";
import mouseComponentsHelpers from "./mouse-components-helpers.ts";

const { selectTheme } = mouseComponentsHelpers;

class SubmenuHost extends Container {
  readonly list = new SelectList(
    [
      { label: "First", value: "first" },
      { label: "Second", value: "second" },
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

export default SubmenuHost;
