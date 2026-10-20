import type autocompleteTypes from "./autocomplete.types.ts";
import type boxTypes from "./components/box.types.ts";
import type cancellableLoaderTypes from "./components/cancellable-loader.types.ts";
import type hStackTypes from "./components/h-stack.types.ts";
import type inputTypes from "./components/input.types.ts";
import type markdownTypes from "./components/markdown.types.ts";
import type tuiMainScreenTypes from "./tui-main-screen.types.ts";
import type wheelScrollTypes from "./wheel-scroll.types.ts";

declare namespace tuiTypesPart5 {
  type TuiMainScreenRenderState = tuiMainScreenTypes.TuiMainScreenRenderState;
  type WheelScrollLines = wheelScrollTypes.WheelScrollLines;
  type CombinedAutocompleteProvider = autocompleteTypes.CombinedAutocompleteProvider;
  type Box = boxTypes.Box;
  type CancellableLoader = cancellableLoaderTypes.CancellableLoader;
  type HStack = hStackTypes.HStack;
  type Input = inputTypes.Input;
  type Markdown = markdownTypes.Markdown;
  type TuiMainScreen = tuiMainScreenTypes.TuiMainScreen;
}

export type { tuiTypesPart5 as default };
