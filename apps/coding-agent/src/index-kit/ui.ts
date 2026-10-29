import modes from "../modes/index.ts";
import components from "../modes/interactive/components/index.ts";
import Theme from "../modes/interactive/theme/theme-class.ts";
import themeModule from "../modes/interactive/theme/theme.ts";

const uiKit: {
  readonly AssistantMessageComponent: typeof components.AssistantMessageComponent;
  readonly BashExecutionComponent: typeof components.BashExecutionComponent;
  readonly BorderedLoader: typeof components.BorderedLoader;
  readonly BranchSummaryMessageComponent: typeof components.BranchSummaryMessageComponent;
  readonly CompactionSummaryMessageComponent: typeof components.CompactionSummaryMessageComponent;
  readonly CustomEditor: typeof components.CustomEditor;
  readonly CustomMessageComponent: typeof components.CustomMessageComponent;
  readonly DynamicBorder: typeof components.DynamicBorder;
  readonly ExtensionEditorComponent: typeof components.ExtensionEditorComponent;
  readonly ExtensionInputComponent: typeof components.ExtensionInputComponent;
  readonly ExtensionSelectorComponent: typeof components.ExtensionSelectorComponent;
  readonly FooterComponent: typeof components.FooterComponent;
  readonly InteractiveMode: typeof modes.InteractiveMode;
  readonly LoginDialogComponent: typeof components.LoginDialogComponent;
  readonly ModelSelectorComponent: typeof components.ModelSelectorComponent;
  readonly OAuthSelectorComponent: typeof components.OAuthSelectorComponent;
  readonly RpcClient: typeof modes.RpcClient;
  readonly SessionSelectorComponent: typeof components.SessionSelectorComponent;
  readonly SettingsSelectorComponent: typeof components.SettingsSelectorComponent;
  readonly ShowImagesSelectorComponent: typeof components.ShowImagesSelectorComponent;
  readonly SkillInvocationMessageComponent: typeof components.SkillInvocationMessageComponent;
  readonly Theme: typeof Theme;
  readonly ThemeSelectorComponent: typeof components.ThemeSelectorComponent;
  readonly ThinkingSelectorComponent: typeof components.ThinkingSelectorComponent;
  readonly ToolExecutionComponent: typeof components.ToolExecutionComponent;
  readonly TreeSelectorComponent: typeof components.TreeSelectorComponent;
  readonly UserMessageComponent: typeof components.UserMessageComponent;
  readonly UserMessageSelectorComponent: typeof components.UserMessageSelectorComponent;
  readonly getAvailableThemesWithPaths: typeof themeModule.getAvailableThemesWithPaths;
  readonly getLanguageFromPath: typeof themeModule.getLanguageFromPath;
  readonly getMarkdownTheme: typeof themeModule.getMarkdownTheme;
  readonly getSelectListTheme: typeof themeModule.getSelectListTheme;
  readonly getSettingsListTheme: typeof themeModule.getSettingsListTheme;
  readonly highlightCode: typeof themeModule.highlightCode;
  readonly initTheme: typeof themeModule.initTheme;
  readonly keyHint: typeof components.keyHint;
  readonly keyText: typeof components.keyText;
  readonly rawKeyHint: typeof components.rawKeyHint;
  readonly renderDiff: typeof components.renderDiff;
  readonly runPrintMode: typeof modes.runPrintMode;
  readonly runRpcMode: typeof modes.runRpcMode;
  readonly truncateToVisualLines: typeof components.truncateToVisualLines;
} = {
  AssistantMessageComponent: components.AssistantMessageComponent,
  BashExecutionComponent: components.BashExecutionComponent,
  BorderedLoader: components.BorderedLoader,
  BranchSummaryMessageComponent: components.BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent: components.CompactionSummaryMessageComponent,
  CustomEditor: components.CustomEditor,
  CustomMessageComponent: components.CustomMessageComponent,
  DynamicBorder: components.DynamicBorder,
  ExtensionEditorComponent: components.ExtensionEditorComponent,
  ExtensionInputComponent: components.ExtensionInputComponent,
  ExtensionSelectorComponent: components.ExtensionSelectorComponent,
  FooterComponent: components.FooterComponent,
  InteractiveMode: modes.InteractiveMode,
  LoginDialogComponent: components.LoginDialogComponent,
  ModelSelectorComponent: components.ModelSelectorComponent,
  OAuthSelectorComponent: components.OAuthSelectorComponent,
  RpcClient: modes.RpcClient,
  SessionSelectorComponent: components.SessionSelectorComponent,
  SettingsSelectorComponent: components.SettingsSelectorComponent,
  ShowImagesSelectorComponent: components.ShowImagesSelectorComponent,
  SkillInvocationMessageComponent: components.SkillInvocationMessageComponent,
  Theme,
  ThemeSelectorComponent: components.ThemeSelectorComponent,
  ThinkingSelectorComponent: components.ThinkingSelectorComponent,
  ToolExecutionComponent: components.ToolExecutionComponent,
  TreeSelectorComponent: components.TreeSelectorComponent,
  UserMessageComponent: components.UserMessageComponent,
  UserMessageSelectorComponent: components.UserMessageSelectorComponent,
  getAvailableThemesWithPaths: themeModule.getAvailableThemesWithPaths,
  getLanguageFromPath: themeModule.getLanguageFromPath,
  getMarkdownTheme: themeModule.getMarkdownTheme,
  getSelectListTheme: themeModule.getSelectListTheme,
  getSettingsListTheme: themeModule.getSettingsListTheme,
  highlightCode: themeModule.highlightCode,
  initTheme: themeModule.initTheme,
  keyHint: components.keyHint,
  keyText: components.keyText,
  rawKeyHint: components.rawKeyHint,
  renderDiff: components.renderDiff,
  runPrintMode: modes.runPrintMode,
  runRpcMode: modes.runRpcMode,
  truncateToVisualLines: components.truncateToVisualLines,
};

export default uiKit;
