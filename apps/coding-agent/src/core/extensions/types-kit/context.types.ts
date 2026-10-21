import type execTypes from "../../exec.types.ts";
import type keybindingsTypes from "../../keybindings.types.ts";
import type typesContextActionsTypes from "../types-context-actions.ts";
import type typesContextTypes from "../types-context.ts";
import type typesUiTypes from "../types-ui.ts";

declare namespace extensionsContextKit {
  type ExecOptions = execTypes.ExecOptions;
  type ExecResult = execTypes.ExecResult;
  type AppKeybinding = keybindingsTypes.AppKeybinding;
  type KeybindingsManager = keybindingsTypes.KeybindingsManager;
  type ExtensionContextActions = typesContextActionsTypes.ExtensionContextActions;
  type ExtensionCommandContextActions = typesContextActionsTypes.ExtensionCommandContextActions;
  type ExtensionRuntime = typesContextActionsTypes.ExtensionRuntime;
  type ExtensionContext = typesContextTypes.ExtensionContext;
  type ExecuteToolOptions = typesContextTypes.ExecuteToolOptions;
  type ExtensionToolContext = typesContextTypes.ExtensionToolContext;
  type ExtensionCommandContext = typesContextTypes.ExtensionCommandContext;
  type ReplacedSessionContext = typesContextTypes.ReplacedSessionContext;
  type ExtensionUIDialogOptions = typesUiTypes.ExtensionUIDialogOptions;
  type WidgetPlacement = typesUiTypes.WidgetPlacement;
  type ExtensionWidgetOptions = typesUiTypes.ExtensionWidgetOptions;
  type TerminalInputHandler = typesUiTypes.TerminalInputHandler;
  type WorkingIndicatorOptions = typesUiTypes.WorkingIndicatorOptions;
  type AutocompleteProviderFactory = typesUiTypes.AutocompleteProviderFactory;
  type EditorFactory = typesUiTypes.EditorFactory;
  type ExtensionUIContext = typesUiTypes.ExtensionUIContext;
  type ContextUsage = typesUiTypes.ContextUsage;
  type CompactOptions = typesUiTypes.CompactOptions;
  type ExtensionMode = typesUiTypes.ExtensionMode;
}

export type { extensionsContextKit as default };
