import BorderedLoader from "../bordered-loader.ts";
import CustomEditor from "../custom-editor.ts";
import DynamicBorder from "../dynamic-border.ts";
import FooterComponent from "../footer.ts";
import keybindingHints from "../keybinding-hints.ts";

const chromeKit: {
  readonly BorderedLoader: typeof BorderedLoader;
  readonly CustomEditor: typeof CustomEditor;
  readonly DynamicBorder: typeof DynamicBorder;
  readonly FooterComponent: typeof FooterComponent;
  readonly keyHint: typeof keybindingHints.keyHint;
  readonly keyText: typeof keybindingHints.keyText;
  readonly rawKeyHint: typeof keybindingHints.rawKeyHint;
} = {
  BorderedLoader,
  CustomEditor,
  DynamicBorder,
  FooterComponent,
  keyHint: keybindingHints.keyHint,
  keyText: keybindingHints.keyText,
  rawKeyHint: keybindingHints.rawKeyHint,
};

export default chromeKit;
