import type altScreenTerminalModesTypes from "./alt-screen-terminal-modes.types.ts";
import type altScreenViewTypes from "./alt-screen-view.ts";
import type altScreenFlashTypes from "./components/alt-screen-flash.types.ts";
import type scrollViewTypes from "./components/scroll-view.types.ts";
import type terminalProtocolTypes from "./terminal-protocol.types.ts";
import tuiAltScreenBaseKit from "./tui-alt-screen-base-kit.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import tuiInterface from "./tui-interface.ts";
import type tuiInterfaceTypes from "./tui-interface.types.ts";
import TuiBase from "./tui.ts";

const {
  AltScreenFlashContainer,
  altScreenTerminalModes,
  altScreenViewportKeys,
  layout,
  ScrollView,
} = tuiAltScreenBaseKit;

const { VIEWPORT_TUI } = tuiInterface;
const { getScrollViewBox } = layout;
const { findPromptRow } = altScreenViewportKeys;
const {
  enterAltScreenSequence,
  exitAltScreenPreservingSequence,
  leaveAltScreenSequence,
  restoreCapabilities,
  restoreDocumentSequence,
  restoredDocument,
  suspendInlineImages,
} = altScreenTerminalModes;

export default abstract class AltScreenTuiBase
  extends TuiBase
  implements tuiInterfaceTypes.ViewportTUI
{
  readonly mode = "fullscreen" as const;
  readonly [VIEWPORT_TUI] = true as const;
  protected readonly frame: altScreenViewTypes.AltScreenFrameState = {
    currentLayout: undefined,
    previousScreen: [],
    previousScreenHeight: 0,
    previousScreenWidth: 0,
  };
  protected readonly view: altScreenViewTypes.AltScreenView;
  protected readonly implicitScrollView: scrollViewTypes.ScrollView;
  protected readonly flashes: altScreenFlashTypes.AltScreenFlashContainer;
  protected layoutRoot: tuiComponentTypes.Component | undefined;
  protected altScreenActive = false;
  protected images: altScreenTerminalModesTypes.ImageCapabilities = {
    protocol: null,
    saved: undefined,
  };
  private readonly mouseEnabled: boolean;
  private lastDocument: string[] = [];

  constructor(
    terminal: terminalProtocolTypes.Terminal,
    showHardwareCursor: boolean | undefined,
    logDirectory: string | undefined,
    mouseEnabled: boolean,
  ) {
    super(terminal, showHardwareCursor, logDirectory);
    const implicitDocument: tuiComponentTypes.Component = {
      handleMouse: (event) => super.handleMouse(event),
      invalidate: () => {
        for (const child of this.children) child.invalidate();
      },
      render: (width) => super.render(width),
    };
    this.implicitScrollView = new ScrollView(implicitDocument, { follow: "end", primary: true });
    this.flashes = new AltScreenFlashContainer(() => this.requestRender());
    this.mouseEnabled = mouseEnabled;
    this.view = {
      columns: () => this.terminal.columns,
      frame: this.frame,
      hasOverlay: () => this.hasOverlay(),
      primaryScrollView: () => this.getPrimaryScrollView(),
      requestRender: () => this.requestRender(),
      rows: () => this.terminal.rows,
    };
  }

  protected abstract resetInteraction(): void;

  protected abstract stopInteraction(): void;

  protected abstract clearImageCache(): void;

  get viewportTop(): number {
    return this.getPrimaryScrollView().scrollTop;
  }

  get isFollowingOutput(): boolean {
    return this.getPrimaryScrollView().isFollowingEnd;
  }

  setLayoutRoot(component: tuiComponentTypes.Component | undefined): void {
    if (this.layoutRoot === component) return;
    this.layoutRoot = component;
    this.frame.currentLayout = undefined;
    this.requestRender();
  }

  override render(width: number): string[] {
    return this.layoutRoot?.render(width) ?? super.render(width);
  }

  protected override getMountedRoots(): readonly tuiComponentTypes.Component[] {
    return this.layoutRoot === undefined ? this.children : [this.layoutRoot];
  }

  protected getPrimaryScrollView(): scrollViewTypes.ScrollView {
    return this.frame.currentLayout?.primaryScrollView ?? this.implicitScrollView;
  }

  protected override resetRenderState(): void {
    this.frame.previousScreen = [];
    this.frame.previousScreenWidth = 0;
    this.frame.previousScreenHeight = 0;
    this.frame.currentLayout = undefined;
  }

  scrollBy(lines: number): void {
    this.getPrimaryScrollView().scrollBy(lines);
    this.requestRender();
  }

  scrollToTop(): void {
    this.getPrimaryScrollView().scrollToStart();
    this.requestRender();
  }

  scrollToBottom(): void {
    this.getPrimaryScrollView().scrollToEnd();
    this.requestRender();
  }

  flash(message: string, durationMs?: number): void {
    this.flashes.flash(message, durationMs);
  }

  protected scrollToPrompt(direction: -1 | 1): void {
    if (this.frame.currentLayout === undefined) return;
    const scrollView = this.getPrimaryScrollView();
    const lines = getScrollViewBox(this.frame.currentLayout, scrollView)?.scrollContentLines;
    if (lines === undefined) return;
    const row = findPromptRow(lines, { direction, from: scrollView.scrollTop });
    if (row === undefined) return;
    scrollView.scrollTo(row);
    this.requestRender();
  }

  protected override beforeTerminalStart(): void {
    this.resetInteraction();
    this.flashes.dispose();
    this.altScreenActive = true;
    const images = suspendInlineImages();
    this.images = { protocol: images.protocol, saved: images.saved ?? this.images.saved };
    this.clearImageCache();
    if (images.saved !== undefined) this.invalidate();
    this.lastDocument = [];
    this.resetRenderState();
    this.terminal.write(enterAltScreenSequence(this.mouseEnabled));
  }

  protected override beforeTerminalStop(_options: tuiInterfaceTypes.TuiStopOptions): void {
    this.stopInteraction();
    this.flashes.dispose();
    if (!this.altScreenActive) return;
    this.terminal.write(leaveAltScreenSequence(this.images.protocol, this.mouseEnabled));
    this.clearImageCache();
  }

  protected override afterTerminalStop(options: tuiInterfaceTypes.TuiStopOptions): void {
    if (!this.altScreenActive) return;
    this.altScreenActive = false;
    if (options.preserveScreen === true) {
      this.terminal.write(exitAltScreenPreservingSequence());
    } else {
      const width = Math.max(1, this.terminal.columns);
      this.lastDocument = restoredDocument(this.resolveFakeCursors(this.render(width)), width);
      this.terminal.write(restoreDocumentSequence(this.lastDocument));
    }
    restoreCapabilities(this.images.saved);
    this.images = { protocol: this.images.protocol, saved: undefined };
  }
}
