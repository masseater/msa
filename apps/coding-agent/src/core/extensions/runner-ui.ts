import { type Theme, theme } from "../../modes/interactive/theme/theme.ts";
import type { ExtensionUIContext } from "./types.ts";

export const noOpUIContext: ExtensionUIContext = {
  addAutocompleteProvider: () => {},
  confirm: () => Promise.resolve(false),
  custom: () => Promise.resolve(undefined as never),
  editor: () => Promise.resolve(undefined),
  getAllThemes: () => [],
  getEditorComponent: () => undefined,
  getEditorText: () => "",
  getTheme: () => undefined,
  getToolsExpanded: () => false,
  input: () => Promise.resolve(undefined),
  notify: () => {},
  onTerminalInput: () => () => {},
  pasteToEditor: () => {},
  select: () => Promise.resolve(undefined),
  setEditorComponent: () => {},
  setEditorText: () => {},
  setFooter: () => {},
  setHeader: () => {},
  setHiddenThinkingLabel: () => {},
  setStatus: () => {},
  setTheme: (_theme: string | Theme) => ({ success: false, error: "UI not available" }),
  setTitle: () => {},
  setToolsExpanded: () => {},
  setWidget: () => {},
  setWorkingIndicator: () => {},
  setWorkingMessage: () => {},
  setWorkingVisible: () => {},
  get theme() {
    return theme;
  },
};
