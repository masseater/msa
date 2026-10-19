import type { ExtensionUIContext } from "../../../src/core/extensions/index.ts";
import { theme } from "../../../src/modes/interactive/theme/theme.ts";

export function createTestUiContext(
  overrides: Partial<ExtensionUIContext> = {},
): ExtensionUIContext {
  return {
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
    custom: <T>() => Promise.resolve(undefined as T),
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
    setTheme: () => ({ success: false, error: "Theme switching not available in tests" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
    ...overrides,
  };
}
