import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import FooterDataProvider from "../../../core/footer-data-provider.ts";
import FooterComponent from "../components/footer.ts";
import EditorSlot from "../editor-slot.ts";
import ExtensionWidgets from "../extension-widgets.ts";
import type InteractiveMode from "../interactive-mode.ts";
import ProgramStatusReporter from "../program-status-reporter.ts";

const { Container } = tuiModule;

export default class InteractiveLayout {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
    this.programStatus = new ProgramStatusReporter(
      () => mode.ui.terminal,
      () => mode.sessionManager.getSessionName(),
    );
  }

  readonly chatContainer: tuiTypes.Container = new Container();

  readonly headerContainer: tuiTypes.Container = new Container();

  readonly loadedResourcesContainer: tuiTypes.Container = new Container();

  readonly pendingMessagesContainer: tuiTypes.Container = new Container();

  readonly statusContainer: tuiTypes.Container = new Container();

  readonly editorContainer: tuiTypes.Container = new Container();

  readonly footerContainer: tuiTypes.Container = new Container();

  readonly programStatus: ProgramStatusReporter;

  documentContainer!: tuiTypes.Container;

  transcriptScrollView!: tuiTypes.ScrollView | undefined;

  fullscreenLayoutRoot!: tuiTypes.Component | undefined;

  footerDataProvider!: FooterDataProvider;

  extensionWidgets!: ExtensionWidgets;

  customFooter: (tuiTypes.Component & { dispose?(): void }) | undefined = undefined;

  builtInHeader: tuiTypes.Component | undefined = undefined;

  customHeader: (tuiTypes.Component & { dispose?(): void }) | undefined = undefined;

  createDocumentContainer(): tuiTypes.Container {
    const container = new Container();
    container.addChild(this.headerContainer);
    container.addChild(this.loadedResourcesContainer);
    container.addChild(this.chatContainer);
    return container;
  }

  build(): EditorSlot {
    const { mode } = this;
    this.documentContainer = this.createDocumentContainer();
    this.extensionWidgets = new ExtensionWidgets(mode.ui);
    this.editorContainer.addChild(mode.editor as tuiTypes.Component);
    return new EditorSlot(this.editorContainer, mode.ui, () => mode.editor);
  }

  createFooter(): FooterComponent {
    const { mode } = this;
    this.footerDataProvider = new FooterDataProvider(mode.sessionManager.getCwd());
    const footer = new FooterComponent(mode.session, this.footerDataProvider);
    footer.setAutoCompactEnabled(mode.session.compaction.auto.autoCompactionEnabled);
    this.footerContainer.addChild(footer);
    return footer;
  }
}
