import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import config from "../../config.ts";
import type agentSessionRuntimeTypes from "../../core/agent-session-runtime.types.ts";
import FooterDataProvider from "../../core/footer-data-provider.ts";
import KeybindingsManager from "../../core/keybindings-manager.ts";
import FooterComponent from "./components/footer.ts";
import EditorSlot from "./editor-slot.ts";
import ExtensionWidgets from "./extension-widgets.ts";
import InteractiveModeLayer48 from "./interactive-mode-layer-48.ts";
import type interactiveModeTypes from "./interactive-mode.types.ts";
import themeModule from "./theme/theme.ts";
import tuiRenderer from "./tui-renderer.ts";

const { Container, setCapabilityOverrides, setKeybindings } = tuiModule;
const { VERSION } = config;
const { createInteractiveTuiReference } = tuiRenderer;
const { setRegisteredThemes } = themeModule;

export default class InteractiveMode extends InteractiveModeLayer48 {
  constructor(
    runtimeHost: agentSessionRuntimeTypes.AgentSessionRuntime,
    options: interactiveModeTypes.InteractiveModeOptions = {},
  ) {
    super(runtimeHost);
    setCapabilityOverrides(this.settingsManager.getTerminalCapabilityOverrides());
    const tuiMode = options.tuiMode ?? this.settingsManager.getTuiMode();
    this.options = { ...options, tuiMode };
    this.autoTrustOnReloadCwd = options.autoTrustOnReloadCwd;
    this.runtimeHost.setBeforeSessionInvalidate(() => {
      this.resetExtensionUI();
    });
    this.runtimeHost.setRebindSession(() =>
      this.rebindCurrentSession({ renderBeforeBind: true }).then(() =>
        this.themeController.applyFromSettings(),
      ),
    );
    this.version = VERSION;
    this.renderer = this.createRenderer(options.terminal, tuiMode);
    this.ui = createInteractiveTuiReference(() => this.renderer);
    this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
    this.headerContainer = new Container();
    this.loadedResourcesContainer = new Container();
    this.chatContainer = new Container();
    this.documentContainer = this.createDocumentContainer();
    this.pendingMessagesContainer = new Container();
    this.statusContainer = new Container();
    this.extensionWidgets = new ExtensionWidgets(this.ui);
    this.keybindings = KeybindingsManager.create();
    setKeybindings(this.keybindings);
    this.defaultEditor = this.createDefaultEditor();
    this.editor = this.defaultEditor;
    this.editorContainer = new Container();
    this.editorContainer.addChild(this.editor as tuiTypes.Component);
    this.editorSlot = new EditorSlot(this.editorContainer, this.ui, () => this.editor);
    this.extensionDialogs = this.createExtensionDialogs();
    this.loginFlow = this.createLoginFlow();
    this.footerDataProvider = new FooterDataProvider(this.sessionManager.getCwd());
    this.footer = new FooterComponent(this.session, this.footerDataProvider);
    this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
    this.footerContainer = new Container();
    this.footerContainer.addChild(this.footer);
    this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
    this.outputPad = this.settingsManager.getOutputPad();
    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    this.themeController = this.createThemeController(options.initialThemeSetting);
  }
}
