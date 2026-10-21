import type altScreenPainterTypes from "./alt-screen-painter.types.ts";
import type altScreenPointerTypes from "./alt-screen-pointer.types.ts";
import type altScreenSearchControllerTypes from "./alt-screen-search-controller.types.ts";
import altScreenViewportKeys from "./alt-screen-viewport-keys.ts";
import type altScreenViewportKeysTypes from "./alt-screen-viewport-keys.types.ts";
import type terminalProtocolTypes from "./terminal-protocol.types.ts";
import AltScreenTuiBase from "./tui-alt-screen-base.ts";
import tuiAltScreenKit from "./tui-alt-screen-kit.ts";
import type tuiAltScreenTypes from "./tui-alt-screen.types.ts";
import type wheelScrollTypes from "./wheel-scroll.types.ts";

const {
  altScreenClipboard,
  altScreenMouseProtocol,
  AltScreenPainter,
  AltScreenPointer,
  AltScreenSearchController,
} = tuiAltScreenKit;

const { copyToClipboard } = altScreenClipboard;
const { focusEvent, isMouseSequence, parseSgrMouseEvent, parseWheelEvent } = altScreenMouseProtocol;
const { handleViewportKey } = altScreenViewportKeys;

export default class TuiAltScreen extends AltScreenTuiBase {
  private readonly search: altScreenSearchControllerTypes.AltScreenSearchController;
  private readonly pointer: altScreenPointerTypes.AltScreenPointer;
  private readonly painter: altScreenPainterTypes.AltScreenPainter;
  private readonly copySelection: ((text: string) => Promise<boolean | string>) | undefined;
  private readonly viewportKeys: altScreenViewportKeysTypes.ViewportKeyTarget;
  private copyOnSelect: boolean;

  constructor(
    terminal: terminalProtocolTypes.Terminal,
    showHardwareCursor?: boolean,
    logDirectory?: string,
    options: tuiAltScreenTypes.TuiAltScreenOptions = {},
  ) {
    super(terminal, showHardwareCursor, logDirectory, options.mouse ?? true);
    this.copyOnSelect = options.copyOnSelect ?? true;
    this.copySelection = options.copySelection;
    this.search = new AltScreenSearchController({
      navigationButtonStyle: options.searchNavigationButtonStyle ?? ((text) => text),
      showOverlay: (component, overlayOptions) => this.showOverlay(component, overlayOptions),
      styles: {
        current: options.searchCurrentMatchStyle ?? ((text) => `\x1b[1;7m${text}\x1b[22;27m`),
        match: options.searchMatchStyle ?? ((text) => `\x1b[4m${text}\x1b[24m`),
      },
      view: this.view,
    });
    this.pointer = this.createPointer(options);
    this.painter = this.createPainter();
    this.viewportKeys = this.createViewportKeys();
    this.addInputListener((data) => this.handleViewportInput(data));
  }

  setWheelScrollLines(lines: wheelScrollTypes.WheelScrollLines): void {
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
      flash: (message, durationMs) => this.flash(message, durationMs),
      write: (data) => this.terminal.write(data),
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

  private createPointer(
    options: tuiAltScreenTypes.TuiAltScreenOptions,
  ): altScreenPointerTypes.AltScreenPointer {
    return new AltScreenPointer({
      copyOnSelect: () => this.copyOnSelect,
      copySelection: () => void this.copyActiveSelectionToClipboard(),
      dispatchToOverlay: (event) => this.dispatchMouseToOverlay(event),
      focusedComponent: () => this.getFocusedComponent(),
      onRightClickPaste: options.onRightClickPaste,
      openUrl: options.openUrl,
      resolveFocusTarget: (component) => this.resolveMouseFocusTarget(component),
      scrollToBottom: () => this.scrollToBottom(),
      scrollToEndIndicator: options.scrollToEndIndicator,
      search: this.search,
      setFocus: (component) => this.setFocus(component),
      view: this.view,
      wheelScrollLines: options.wheelScrollLines ?? 1,
    });
  }

  private createPainter(): altScreenPainterTypes.AltScreenPainter {
    return new AltScreenPainter({
      applyLineResets: (lines) => this.applyLineResets(lines),
      compositeOverlays: (lines, width, height) => this.compositeOverlays(lines, width, height),
      extractCursorPosition: (lines, height) => this.extractCursorPosition(lines, height),
      imageProtocol: () => this.images.protocol,
      implicitScrollView: this.implicitScrollView,
      layoutRoot: () => this.layoutRoot,
      onFullRedraw: () => {
        this.fullRedrawCount += 1;
      },
      pointer: this.pointer,
      renderFlashes: (width) => this.flashes.render(width),
      resolveFakeCursors: (lines) => this.resolveFakeCursors(lines),
      search: this.search,
      showHardwareCursor: () => this.getShowHardwareCursor(),
      view: this.view,
      write: (data) => this.terminal.write(data),
    });
  }

  private createViewportKeys(): altScreenViewportKeysTypes.ViewportKeyTarget {
    return {
      closeSearch: () => this.search.close(),
      isSearchFocused: () => this.search.isFocused(),
      navigateSearch: (direction) => this.search.navigate(direction),
      scrollBy: (lines) => this.scrollBy(lines),
      scrollToBottom: () => this.scrollToBottom(),
      scrollToPrompt: (direction) => this.scrollToPrompt(direction),
      scrollToTop: () => this.scrollToTop(),
      shouldDeferToOverlay: () =>
        (this.isOverlayFocused() && !this.search.isFocused()) ||
        this.getFocusedComponent()?.wantsViewportKeys === true,
      toggleSearch: () => this.search.toggle(),
      viewportHeight: () => this.getPrimaryScrollView().viewportHeight,
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
