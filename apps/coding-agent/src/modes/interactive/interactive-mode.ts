import type interactiveModeHandlesTypes from "./interactive-mode-handles.types.ts";
import ModeCommands from "./mode/commands.ts";
import ModeDisplay from "./mode/display.ts";
import ModeExtensions from "./mode/extensions.ts";
import InputHandling from "./mode/input.ts";
import InteractiveLayout from "./mode/layout.ts";
import ModeLifecycle from "./mode/lifecycle.ts";
import ModeModels from "./mode/models.ts";
import ModeSelectors from "./mode/selectors.ts";
import ChatView from "./mode/view.ts";

export default class InteractiveMode {
  readonly runtimeHost: interactiveModeHandlesTypes.RuntimeHost;
  readonly layout: InteractiveLayout;
  readonly view: ChatView;
  readonly display: ModeDisplay;
  readonly input: InputHandling;
  readonly commands: ModeCommands;
  readonly selectors: ModeSelectors;
  readonly models: ModeModels;
  readonly extensions: ModeExtensions;
  readonly lifecycle: ModeLifecycle;

  options: interactiveModeHandlesTypes.Options;
  ui!: interactiveModeHandlesTypes.Tui;
  keybindings!: interactiveModeHandlesTypes.Keybindings;
  defaultEditor!: interactiveModeHandlesTypes.DefaultEditor;
  editor!: interactiveModeHandlesTypes.ActiveEditor;
  editorSlot!: interactiveModeHandlesTypes.EditorSlot;
  footer!: interactiveModeHandlesTypes.Footer;

  constructor(
    runtimeHost: interactiveModeHandlesTypes.RuntimeHost,
    options: interactiveModeHandlesTypes.Options = {},
  ) {
    this.runtimeHost = runtimeHost;
    this.layout = new InteractiveLayout(this);
    this.view = new ChatView(this);
    this.display = new ModeDisplay(this);
    this.input = new InputHandling(this);
    this.commands = new ModeCommands(this);
    this.selectors = new ModeSelectors(this);
    this.models = new ModeModels(this);
    this.extensions = new ModeExtensions(this);
    this.lifecycle = new ModeLifecycle(this);
    this.options = this.lifecycle.screen.resolveOptions(options);
    this.commands.reload.autoTrustOnReloadCwd = options.autoTrustOnReloadCwd;
    this.extensions.binding.attachToRuntimeHost();
    this.ui = this.lifecycle.screen.createUi();
    this.keybindings = this.input.editors.createKeybindings();
    this.defaultEditor = this.input.editors.createDefaultEditor();
    this.editor = this.defaultEditor;
    this.editorSlot = this.layout.build();
    this.footer = this.layout.createFooter();
    this.extensions.dialogs.start();
    this.models.login.start();
    this.display.thinking.loadSettings();
    this.display.theme.start(options.initialThemeSetting);
  }

  get session() {
    return this.runtimeHost.session;
  }

  get sessionManager() {
    return this.session.sessionManager;
  }

  get settingsManager() {
    return this.session.settingsManager;
  }
}
