import keybindings from "../keybindings.ts";
import EditorAutocomplete from "./editor-autocomplete.ts";
import EditorCommands from "./editor-commands.ts";
import EditorDocument from "./editor-document.ts";
import editorKeys from "./editor-keys.ts";
import editorLimits from "./editor-limits.ts";

const editorKit = {
  EditorAutocomplete,
  EditorCommands,
  EditorDocument,
  editorKeys,
  editorLimits,
  keybindings,
};

export default editorKit;
