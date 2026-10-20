import type scrollViewTypes from "./components/scroll-view.types.ts";
import type selectListTypes from "./components/select-list.types.ts";
import type settingsListItemsTypes from "./components/settings-list-items.types.ts";
import type splitPaneTypes from "./components/split-pane.types.ts";
import type stackTypes from "./components/stack.types.ts";
import type editorComponentTypes from "./editor-component.ts";
import type fuzzyTypes from "./fuzzy.types.ts";
import type keybindingDefinitionsTypes from "./keybinding-definitions.types.ts";

declare namespace tuiTypesPart2 {
  type ScrollViewOptions = scrollViewTypes.ScrollViewOptions;
  type ScrollViewScrollbar = scrollViewTypes.ScrollViewScrollbar;
  type ScrollViewScrollToOptions = scrollViewTypes.ScrollViewScrollToOptions;
  type SelectItem = selectListTypes.SelectItem;
  type SelectListLayoutOptions = selectListTypes.SelectListLayoutOptions;
  type SelectListTheme = selectListTypes.SelectListTheme;
  type SelectListTruncatePrimaryContext = selectListTypes.SelectListTruncatePrimaryContext;
  type SettingItem = settingsListItemsTypes.SettingItem;
  type SettingsListTheme = settingsListItemsTypes.SettingsListTheme;
  type SplitPaneOptions = splitPaneTypes.SplitPaneOptions;
  type SplitPaneWidths = splitPaneTypes.SplitPaneWidths;
  type StackChild = stackTypes.StackChild;
  type StackEntry = stackTypes.StackEntry;
  type StackEntryOptions = stackTypes.StackEntryOptions;
  type StackOptions = stackTypes.StackOptions;
  type EditorComponent = editorComponentTypes.EditorComponent;
  type FuzzyMatch = fuzzyTypes.FuzzyMatch;
  type Keybinding = keybindingDefinitionsTypes.Keybinding;
  type KeybindingDefinition = keybindingDefinitionsTypes.KeybindingDefinition;
  type KeybindingDefinitions = keybindingDefinitionsTypes.KeybindingDefinitions;
  type Keybindings = keybindingDefinitionsTypes.Keybindings;
  type KeybindingsConfig = keybindingDefinitionsTypes.KeybindingsConfig;
  type ScrollView = scrollViewTypes.ScrollView;
  type SelectList = selectListTypes.SelectList;
  type SplitPane = splitPaneTypes.SplitPane;
}

export type { tuiTypesPart2 as default };
