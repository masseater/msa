import type terminalColorsTypes from "./terminal-colors.types.ts";
import type terminalProtocolTypes from "./terminal-protocol.types.ts";
import type tuiColorQueriesTypes from "./tui-color-queries.types.ts";
import tuiFrameLines from "./tui-frame-lines.ts";
import type tuiFrameLinesTypes from "./tui-frame-lines.types.ts";
import type tuiInterfaceTypes from "./tui-interface.types.ts";
import tuiKit from "./tui-kit.ts";
import TuiOverlayHost from "./tui-overlay-host.ts";
import RenderScheduler from "./tui-render-scheduler.ts";
import tuiTerminalQueries from "./tui-terminal-queries.ts";

const { keys, TerminalColorQueries } = tuiKit;

const { cellSizeQuery, consumeCellSizeResponse, probeCapabilitiesInBackground } =
  tuiTerminalQueries;
const { isKeyRelease, matchesKey } = keys;
const { applyLineResets, extractCursorPosition, resolveFakeCursors } = tuiFrameLines;

export default abstract class TuiBase extends TuiOverlayHost implements tuiInterfaceTypes.TUI {
  abstract readonly mode: tuiInterfaceTypes.TuiMode;
  private inputListeners = new Set<tuiInterfaceTypes.TuiInputListener>();

  public onDebug?: () => void;
  private readonly scheduler = new RenderScheduler(
    () => this.doRender(),
    () => this.stopped,
  );
  private showHardwareCursor = false;
  private clearOnShrink = false;
  protected fullRedrawCount = 0;
  private readonly colorQueries = new TerminalColorQueries();
  private terminalColorSchemeNotificationsEnabled = false;
  protected readonly logDirectory: string | undefined;

  constructor(
    terminal: terminalProtocolTypes.Terminal,
    showHardwareCursor?: boolean,
    logDirectory?: string,
  ) {
    super(terminal);
    this.logDirectory = logDirectory;
    if (showHardwareCursor !== undefined) {
      this.showHardwareCursor = showHardwareCursor;
    }
  }

  protected abstract doRender(): void;

  protected resetRenderState(): void {}

  protected beforeTerminalStart(): void {}

  protected afterTerminalStart(): void {}

  protected beforeTerminalStop(_options: tuiInterfaceTypes.TuiStopOptions): void {}

  protected afterTerminalStop(_options: tuiInterfaceTypes.TuiStopOptions): void {}

  get fullRedraws(): number {
    return this.fullRedrawCount;
  }

  getShowHardwareCursor(): boolean {
    return this.showHardwareCursor;
  }

  setShowHardwareCursor(enabled: boolean): void {
    if (this.showHardwareCursor === enabled) return;
    this.showHardwareCursor = enabled;
    if (!enabled) {
      this.hideTerminalCursor();
    }
    this.requestRender();
  }

  getClearOnShrink(): boolean {
    return this.clearOnShrink;
  }

  setClearOnShrink(enabled: boolean): void {
    this.clearOnShrink = enabled;
  }

  start(): void {
    this.stopped = false;
    this.beforeTerminalStart();
    this.terminal.start(
      (data) => this.handleTerminalInput(data),
      () => this.requestRender(),
    );
    this.afterTerminalStart();
    this.terminal.hideCursor();
    if (this.terminalColorSchemeNotificationsEnabled) {
      this.terminal.write("\x1b[?2031h");
    }
    this.queryCellSize();
    probeCapabilitiesInBackground(() => {
      if (this.stopped) return;
      this.invalidate();
      this.requestRender();
    });
    this.requestRender();
  }

  addInputListener(listener: tuiInterfaceTypes.TuiInputListener): () => void {
    this.inputListeners.add(listener);
    return () => {
      this.inputListeners.delete(listener);
    };
  }

  removeInputListener(listener: tuiInterfaceTypes.TuiInputListener): void {
    this.inputListeners.delete(listener);
  }

  onTerminalColorSchemeChange(
    listener: (scheme: terminalColorsTypes.TerminalColorScheme) => void,
  ): () => void {
    return this.colorQueries.onSchemeChange(listener);
  }

  setTerminalColorSchemeNotifications(enabled: boolean): void {
    if (this.terminalColorSchemeNotificationsEnabled === enabled) {
      return;
    }
    this.terminalColorSchemeNotificationsEnabled = enabled;
    if (!this.stopped) {
      this.terminal.write(enabled ? "\x1b[?2031h" : "\x1b[?2031l");
    }
  }

  private queryCellSize(): void {
    const query = cellSizeQuery();
    if (query !== "") this.terminal.write(query);
  }

  stop(options: tuiInterfaceTypes.TuiStopOptions = {}): void {
    this.stopped = true;
    this.scheduler.cancel();
    if (this.terminalColorSchemeNotificationsEnabled) {
      this.terminal.write("\x1b[?2031l");
    }
    this.beforeTerminalStop(options);
    this.terminal.showCursor();
    this.terminal.stop();
    this.afterTerminalStop(options);
  }

  renderNow(force = false): void {
    if (force) this.resetRenderState();
    this.scheduler.renderNow();
  }

  requestRender(force = false): void {
    if (force) {
      this.resetRenderState();
      this.scheduler.requestImmediate();
      return;
    }
    this.scheduler.request();
  }

  private applyInputListeners(data: string): string | undefined {
    let current = data;
    for (const listener of this.inputListeners) {
      const result = listener(current);
      if (result?.consume === true) {
        return undefined;
      }
      if (result?.data !== undefined) {
        current = result.data;
      }
    }
    return current.length === 0 ? undefined : current;
  }

  private handleTerminalInput(raw: string): void {
    if (this.colorQueries.consumeResponse(raw) || this.colorQueries.consumeSchemeReport(raw)) {
      return;
    }
    const data = this.inputListeners.size > 0 ? this.applyInputListeners(raw) : raw;
    if (data === undefined || this.consumeCellSizeResponse(data)) {
      return;
    }
    if (matchesKey(data, "shift+ctrl+d") && this.onDebug !== undefined) {
      this.onDebug();
      return;
    }
    this.refreshOverlayFocus();
    const focused = this.getFocusedComponent();
    if (focused?.handleInput !== undefined) {
      if (isKeyRelease(data) && focused.wantsKeyRelease !== true) {
        return;
      }
      focused.handleInput(data);
      this.scheduler.requestImmediate();
    }
  }

  private consumeCellSizeResponse(data: string): boolean {
    const response = consumeCellSizeResponse(data);
    if (response === "updated") {
      this.invalidate();
      this.requestRender();
    }
    return response !== "none";
  }

  protected compositeOverlays(lines: string[], termWidth: number, termHeight: number): string[] {
    return this.overlays.composite(lines, {
      resolveFakeCursors: (overlayLines) => this.resolveFakeCursors(overlayLines),
      termHeight,
      termWidth,
    });
  }

  protected applyLineResets(lines: string[]): string[] {
    return applyLineResets(lines);
  }

  protected extractCursorPosition(
    lines: string[],
    height: number,
  ): tuiFrameLinesTypes.CursorPosition | null {
    return extractCursorPosition(lines, height);
  }

  protected resolveFakeCursors(lines: string[]): string[] {
    return resolveFakeCursors(lines, this.showHardwareCursor);
  }

  queryTerminalColors(
    options: tuiColorQueriesTypes.TerminalColorQueryOptions,
  ): Promise<terminalColorsTypes.TerminalColors> {
    return this.colorQueries.query(options, (data) => this.terminal.write(data));
  }
}
