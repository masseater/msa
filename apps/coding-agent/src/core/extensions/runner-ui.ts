import { type Theme, theme } from "../../modes/interactive/theme/theme.ts";
import type { ExtensionUIContext } from "./types.ts";

export const noOpUIContext: ExtensionUIContext = {
  select: () => Promise.resolve(undefined),
  confirm: () => Promise.resolve(false),
  input: () => Promise.resolve(undefined),
  notify: () => {},
  onTerminalInput: () => () => {},
  setStatus: () => {},
  setWorkingMessage: () => {},
  setWorkingVisible: () => {},
  setWorkingIndicator: () => {},
  setHiddenThinkingLabel: () => {},
  setWidget: () => {},
  setFooter: () => {},
  setHeader: () => {},
  setTitle: () => {},
  custom: () => Promise.resolve(undefined as never),
  pasteToEditor: () => {},
  setEditorText: () => {},
  getEditorText: () => "",
  editor: () => Promise.resolve(undefined),
  addAutocompleteProvider: () => {},
  setEditorComponent: () => {},
  getEditorComponent: () => undefined,
  get theme() {
    return theme;
  },
  getAllThemes: () => [],
  getTheme: () => undefined,
  setTheme: (_theme: string | Theme) => ({ success: false, error: "UI not available" }),
  getToolsExpanded: () => false,
  setToolsExpanded: () => {},
};
