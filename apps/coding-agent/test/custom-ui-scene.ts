import testing from "@msa/testing";
import { Effect } from "effect";

import tuiComponent from "../../../libs/tui/src/tui-component.ts";
import type tuiComponentTypes from "../../../libs/tui/src/tui-component.types.ts";
import type tuiInterfaceTypes from "../../../libs/tui/src/tui-interface.types.ts";
import TuiMainScreen from "../../../libs/tui/src/tui-main-screen.ts";
import VirtualTerminal from "../../../libs/tui/test/virtual-terminal.ts";
import EditorSlot from "../src/modes/interactive/editor-slot.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";
import TestFocusableComponent from "./test-focusable-component.ts";

const { bindModeFake } = interactiveModeFake;
const { Container } = tuiComponent;
const { awaited } = testing;

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
  bindModeFake(fakeThis);
  const showExtensionCustom = <T>(
    factory: CustomFactory<T>,
    options?: { overlay?: boolean },
  ): Promise<T> =>
    bindModeFake(fakeThis).extensions.ui.showExtensionCustom(factory, options) as Promise<T>;
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
  createCustomUiScene,
};

export default customUiScene;
