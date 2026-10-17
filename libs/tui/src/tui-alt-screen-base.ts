import {
  enterAltScreenSequence,
  type ImageCapabilities,
  exitAltScreenPreservingSequence,
  leaveAltScreenSequence,
  restoreCapabilities,
  restoreDocumentSequence,
  restoredDocument,
  suspendInlineImages,
} from "./alt-screen-terminal-modes.ts";
import type { AltScreenFrameState, AltScreenView } from "./alt-screen-view.ts";
import { findPromptRow } from "./alt-screen-viewport-keys.ts";
import { AltScreenFlashContainer } from "./components/alt-screen-flash.ts";
import { ScrollView } from "./components/scroll-view.ts";
import { getScrollViewBox } from "./layout.ts";
import type { Terminal } from "./terminal-protocol.ts";
import type { Component } from "./tui-component.ts";
import { type TuiStopOptions, VIEWPORT_TUI, type ViewportTUI } from "./tui-interface.ts";
import { TuiBase } from "./tui.ts";

export abstract class AltScreenTuiBase extends TuiBase implements ViewportTUI {
  readonly mode = "fullscreen" as const;
  readonly [VIEWPORT_TUI] = true as const;
  protected readonly frame: AltScreenFrameState = {
    previousScreen: [],
    previousScreenWidth: 0,
    previousScreenHeight: 0,
    currentLayout: undefined,
  };
  protected readonly view: AltScreenView;
  protected readonly implicitScrollView: ScrollView;
  protected readonly flashes: AltScreenFlashContainer;
  protected layoutRoot: Component | undefined;
  protected altScreenActive = false;
  protected images: ImageCapabilities = { protocol: null, saved: undefined };
  private readonly mouseEnabled: boolean;
  private lastDocument: string[] = [];

  constructor(
    terminal: Terminal,
    showHardwareCursor: boolean | undefined,
    logDirectory: string | undefined,
    mouseEnabled: boolean,
  ) {
    super(terminal, showHardwareCursor, logDirectory);
    const implicitDocument: Component = {
      render: (width) => super.render(width),
      handleMouse: (event) => super.handleMouse(event),
      invalidate: () => {
        for (const child of this.children) child.invalidate();
      },
    };
    this.implicitScrollView = new ScrollView(implicitDocument, { follow: "end", primary: true });
    this.flashes = new AltScreenFlashContainer(() => this.requestRender());
    this.mouseEnabled = mouseEnabled;
    this.view = {
      frame: this.frame,
      columns: () => this.terminal.columns,
      rows: () => this.terminal.rows,
      primaryScrollView: () => this.getPrimaryScrollView(),
      hasOverlay: () => this.hasOverlay(),
      requestRender: () => this.requestRender(),
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

  getScreenLines(): string[] {
    return [...this.frame.previousScreen];
  }

  setLayoutRoot(component: Component | undefined): void {
    if (this.layoutRoot === component) return;
    this.layoutRoot = component;
    this.frame.currentLayout = undefined;
    this.requestRender();
  }

  override render(width: number): string[] {
    return this.layoutRoot?.render(width) ?? super.render(width);
  }

  protected override getMountedRoots(): readonly Component[] {
    return this.layoutRoot === undefined ? this.children : [this.layoutRoot];
  }

  protected getPrimaryScrollView(): ScrollView {
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
    const row = findPromptRow(lines, { from: scrollView.scrollTop, direction });
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

  protected override beforeTerminalStop(_options: TuiStopOptions): void {
    this.stopInteraction();
    this.flashes.dispose();
    if (!this.altScreenActive) return;
    this.terminal.write(leaveAltScreenSequence(this.images.protocol, this.mouseEnabled));
    this.clearImageCache();
  }

  protected override afterTerminalStop(options: TuiStopOptions): void {
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
