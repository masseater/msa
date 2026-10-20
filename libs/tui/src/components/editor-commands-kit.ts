import EditorHistory from "./editor-history.ts";
import editorKeys from "./editor-keys.ts";
import EditorKillCommands from "./editor-kill.ts";
import EditorMotion from "./editor-motion.ts";
import editorPaste from "./editor-paste.ts";

const editorCommandsKit = {
  EditorHistory,
  EditorKillCommands,
  EditorMotion,
  editorKeys,
  editorPaste,
};

export default editorCommandsKit;
