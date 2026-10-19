import { copyToClipboard } from "./alt-screen-clipboard.ts";
import {
  focusEvent,
  isMouseSequence,
  parseSgrMouseEvent,
  parseWheelEvent,
} from "./alt-screen-mouse-protocol.ts";
import { AltScreenPainter } from "./alt-screen-painter.ts";
import { AltScreenPointer } from "./alt-screen-pointer.ts";
import { AltScreenSearchController } from "./alt-screen-search-controller.ts";
import { handleViewportKey, type ViewportKeyTarget } from "./alt-screen-viewport-keys.ts";
import type { Terminal } from "./terminal-protocol.ts";
import { AltScreenTuiBase } from "./tui-alt-screen-base.ts";
import type { WheelScrollLines } from "./wheel-scroll.ts";

export interface TuiAltScreenOptions {
  wheelScrollLines?: WheelScrollLines;
  mouse?: boolean;
  searchMatchStyle?: (text: string) => string;
  searchCurrentMatchStyle?: (text: string) => string;
  searchNavigationButtonStyle?: (text: string, hovered: boolean) => string;
  scrollToEndIndicator?: () => string;
  openUrl?: (url: string) => void;
  onRightClickPaste?: () => void;
  copyOnSelect?: boolean;
  copySelection?: (text: string) => Promise<boolean | string>;
}

export class TuiAltScreen extends AltScreenTuiBase {
  private readonly search: AltScreenSearchController;
  private readonly pointer: AltScreenPointer;
  private readonly painter: AltScreenPainter;
  private readonly copySelection: ((text: string) => Promise<boolean | string>) | undefined;
  private readonly viewportKeys: ViewportKeyTarget;
  private copyOnSelect: boolean;

  constructor(
    terminal: Terminal,
    showHardwareCursor?: boolean,
    logDirectory?: string,
    options: TuiAltScreenOptions = {},
  ) {
    super(terminal, showHardwareCursor, logDirectory, options.mouse ?? true);
    this.copyOnSelect = options.copyOnSelect ?? true;
    this.copySelection = options.copySelection;
    this.search = new AltScreenSearchController({
      view: this.view,
      styles: {
        match: options.searchMatchStyle ?? ((text) => `\x1b[4m${text}\x1b[24m`),
        current: options.searchCurrentMatchStyle ?? ((text) => `\x1b[1;7m${text}\x1b[22;27m`),
      },
      navigationButtonStyle: options.searchNavigationButtonStyle ?? ((text) => text),
      showOverlay: (component, overlayOptions) => this.showOverlay(component, overlayOptions),
    });
    this.pointer = this.createPointer(options);
    this.painter = this.createPainter();
    this.viewportKeys = this.createViewportKeys();
    this.addInputListener((data) => this.handleViewportInput(data));
  }

  setWheelScrollLines(lines: WheelScrollLines): void {
    this.pointer.setWheelScrollLines(lines);
  }

  getCopyOnSelect(): boolean {
    return this.copyOnSelect;
  }

  setCopyOnSelect(enabled: boolean): void {
    this.copyOnSelect = enabled;
  }

  hasActiveSelection(): boolean {
    return this.pointer.selection.activeText() !== undefined;
  }

  copyActiveSelectionToClipboard(): Promise<boolean> {
    const text = this.pointer.selection.activeText();
    if (text === undefined || text === "") return Promise.resolve(false);
    return copyToClipboard(text, {
      copySelection: this.copySelection,
      write: (data) => this.terminal.write(data),
      flash: (message, durationMs) => this.flash(message, durationMs),
    });
  }

  resetTextSelection(): void {
    this.pointer.selection.reset();
  }

  protected override resetInteraction(): void {
    this.pointer.reset();
  }

  protected override stopInteraction(): void {
    this.search.close();
    this.pointer.stop();
  }

  protected override clearImageCache(): void {
    this.painter.kittyImages.clear();
  }

  protected override doRender(): void {
    if (this.stopped || !this.altScreenActive) return;
    this.painter.paint(Math.max(1, this.terminal.columns), Math.max(1, this.terminal.rows));
  }

  private createPointer(options: TuiAltScreenOptions): AltScreenPointer {
    return new AltScreenPointer({
      view: this.view,
      search: this.search,
      resolveFocusTarget: (component) => this.resolveMouseFocusTarget(component),
      focusedComponent: () => this.getFocusedComponent(),
      setFocus: (component) => this.setFocus(component),
      dispatchToOverlay: (event) => this.dispatchMouseToOverlay(event),
      scrollToBottom: () => this.scrollToBottom(),
      openUrl: options.openUrl,
      onRightClickPaste: options.onRightClickPaste,
      scrollToEndIndicator: options.scrollToEndIndicator,
      wheelScrollLines: options.wheelScrollLines ?? 1,
      copyOnSelect: () => this.copyOnSelect,
      copySelection: () => void this.copyActiveSelectionToClipboard(),
    });
  }

  private createPainter(): AltScreenPainter {
    return new AltScreenPainter({
      view: this.view,
      implicitScrollView: this.implicitScrollView,
      search: this.search,
      pointer: this.pointer,
      layoutRoot: () => this.layoutRoot,
      imageProtocol: () => this.images.protocol,
      showHardwareCursor: () => this.getShowHardwareCursor(),
      renderFlashes: (width) => this.flashes.render(width),
      resolveFakeCursors: (lines) => this.resolveFakeCursors(lines),
      compositeOverlays: (lines, width, height) => this.compositeOverlays(lines, width, height),
      extractCursorPosition: (lines, height) => this.extractCursorPosition(lines, height),
      applyLineResets: (lines) => this.applyLineResets(lines),
      onFullRedraw: () => {
        this.fullRedrawCount += 1;
      },
      write: (data) => this.terminal.write(data),
    });
  }

  private createViewportKeys(): ViewportKeyTarget {
    return {
      toggleSearch: () => this.search.toggle(),
      isSearchFocused: () => this.search.isFocused(),
      navigateSearch: (direction) => this.search.navigate(direction),
      closeSearch: () => this.search.close(),
      shouldDeferToOverlay: () =>
        (this.isOverlayFocused() && !this.search.isFocused()) ||
        this.getFocusedComponent()?.wantsViewportKeys === true,
      viewportHeight: () => this.getPrimaryScrollView().viewportHeight,
      scrollBy: (lines) => this.scrollBy(lines),
      scrollToPrompt: (direction) => this.scrollToPrompt(direction),
      scrollToTop: () => this.scrollToTop(),
      scrollToBottom: () => this.scrollToBottom(),
    };
  }

  private handleViewportInput(data: string): { consume?: boolean } | undefined {
    const focus = focusEvent(data);
    if (focus === "out") {
      this.pointer.focusOut();
      if (this.search.clearHover()) this.requestRender();
      return { consume: true };
    }
    if (focus === "in") return { consume: true };
    const wheelEvent = parseWheelEvent(data);
    if (wheelEvent !== undefined) {
      this.pointer.handleWheel(wheelEvent);
      return { consume: true };
    }
    const mouseEvent = parseSgrMouseEvent(data);
    if (mouseEvent !== undefined) {
      this.pointer.handleMouse(mouseEvent);
      return { consume: true };
    }
    if (isMouseSequence(data)) return { consume: true };
    return handleViewportKey(data, this.viewportKeys);
  }
}
