import themeModule from "../../modes/interactive/theme/theme.ts";
import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { theme } = themeModule;

const noOpUIContext: extensionsTypesTypes.ExtensionUIContext = {
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
  setTheme: (_theme: string | themeTypes.Theme) => ({ error: "UI not available", success: false }),
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

const runnerUi = {
  noOpUIContext,
};

export default runnerUi;
