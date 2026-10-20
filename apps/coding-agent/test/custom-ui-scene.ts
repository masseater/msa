import testing from "@msa/testing";
import { Effect } from "effect";

import tuiComponent from "../../../libs/tui/src/tui-component.ts";
import type tuiComponentTypes from "../../../libs/tui/src/tui-component.types.ts";
import type tuiInterfaceTypes from "../../../libs/tui/src/tui-interface.types.ts";
import TuiMainScreen from "../../../libs/tui/src/tui-main-screen.ts";
import virtualTerminal from "../../../libs/tui/test/virtual-terminal.ts";
import { EditorSlot } from "../src/modes/interactive/editor-slot.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

const { VirtualTerminal } = virtualTerminal;
const { Container } = tuiComponent;

const { awaited } = testing;

class TestFocusableComponent implements tuiComponentTypes.Component, tuiComponentTypes.Focusable {
  focused = false;
  inputs: string[] = [];
  private readonly label: string;
  private text = "";

  constructor(label: string) {
    this.label = label;
  }

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
  }

  render(): string[] {
    return [this.label];
  }

  invalidate(): void {}
}

type CustomFactory<T> = (
  tui: tuiInterfaceTypes.TUI,
  theme: unknown,
  keybindings: unknown,
  done: (result: T) => void,
) => tuiComponentTypes.Component;

const createCustomUiScene = () => {
  const terminal = new VirtualTerminal(80, 24);
  const ui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);
  const editorContainer = new Container();
  const editor = new TestFocusableComponent("EDITOR");
  const palette = new TestFocusableComponent("PALETTE");
  const fakeThis = {
    editor,
    editorSlot: new EditorSlot(editorContainer, ui, () => editor),
    keybindings: {},
    ui,
  };
  const showExtensionCustom = <T>(
    factory: CustomFactory<T>,
    options?: { overlay?: boolean },
  ): Promise<T> =>
    (InteractiveMode as any).prototype.showExtensionCustom.call(
      fakeThis,
      factory,
      options,
    ) as Promise<T>;
  editorContainer.addChild(editor);
  ui.addChild(editorContainer);
  ui.addChild(palette);
  ui.setFocus(palette);
  const flush = Effect.gen(function* () {
    ui.requestRender(true);
    yield* awaited(Promise.resolve());
    yield* awaited(terminal.waitForRender());
  });
  return { editor, flush, showExtensionCustom, terminal, ui };
};

const customUiScene = {
  TestFocusableComponent,
  createCustomUiScene,
};

export default customUiScene;
