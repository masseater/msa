import type { ExtensionUIContext } from "../../../src/core/extensions/index.ts";
import { theme } from "../../../src/modes/interactive/theme/theme.ts";

function createTestUiContext(overrides: Partial<ExtensionUIContext> = {}): ExtensionUIContext {
  return {
    addAutocompleteProvider: () => {},
    confirm: () => Promise.resolve(false),
    custom: <T>() => Promise.resolve(undefined as T),
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
    setTheme: () => ({ error: "Theme switching not available in tests", success: false }),
    setTitle: () => {},
    setToolsExpanded: () => {},
    setWidget: () => {},
    setWorkingIndicator: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    get theme() {
      return theme;
    },
    ...overrides,
  };
}

const uiContext = {
  createTestUiContext,
};

export default uiContext;
