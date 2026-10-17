import { matchCsiSequence } from "./ansi-sequences.ts";
import { isKeyRelease, matchesKey } from "./keys.ts";
import { getCapabilities, setCellDimensions } from "./terminal-capabilities.ts";
import type { TerminalColors, TerminalColorScheme } from "./terminal-colors.ts";
import type { Terminal } from "./terminal-protocol.ts";
import { TerminalColorQueries, type TerminalColorQueryOptions } from "./tui-color-queries.ts";
import {
  applyLineResets,
  type CursorPosition,
  extractCursorPosition,
  resolveFakeCursors,
} from "./tui-frame-lines.ts";
import type { TUI, TuiInputListener, TuiMode, TuiStopOptions } from "./tui-interface.ts";
import { TuiOverlayHost } from "./tui-overlay-host.ts";
import { RenderScheduler } from "./tui-render-scheduler.ts";

const CELL_SIZE_BODY = /^6;(\d+);(\d+)$/u;

export abstract class TuiBase extends TuiOverlayHost implements TUI {
  abstract readonly mode: TuiMode;
  private inputListeners = new Set<TuiInputListener>();

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

  constructor(terminal: Terminal, showHardwareCursor?: boolean, logDirectory?: string) {
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

  protected beforeTerminalStop(_options: TuiStopOptions): void {}

  protected afterTerminalStop(_options: TuiStopOptions): void {}

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
    this.requestRender();
  }

  addInputListener(listener: TuiInputListener): () => void {
    this.inputListeners.add(listener);
    return () => {
      this.inputListeners.delete(listener);
    };
  }

  removeInputListener(listener: TuiInputListener): void {
    this.inputListeners.delete(listener);
  }

  onTerminalColorSchemeChange(listener: (scheme: TerminalColorScheme) => void): () => void {
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
    if (getCapabilities().images === null) {
      return;
    }
    this.terminal.write("\x1b[16t");
  }

  stop(options: TuiStopOptions = {}): void {
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
    const [, height, width] =
      matchCsiSequence({ data, finals: "t", body: CELL_SIZE_BODY })?.groups ?? [];
    if (height === undefined || width === undefined) {
      return false;
    }

    const heightPx = parseInt(height, 10);
    const widthPx = parseInt(width, 10);
    if (heightPx <= 0 || widthPx <= 0) {
      return true;
    }

    setCellDimensions({ widthPx, heightPx });
    this.invalidate();
    this.requestRender();
    return true;
  }

  protected compositeOverlays(lines: string[], termWidth: number, termHeight: number): string[] {
    return this.overlays.composite(lines, {
      termWidth,
      termHeight,
      resolveFakeCursors: (overlayLines) => this.resolveFakeCursors(overlayLines),
    });
  }

  protected applyLineResets(lines: string[]): string[] {
    return applyLineResets(lines);
  }

  protected extractCursorPosition(lines: string[], height: number): CursorPosition | null {
    return extractCursorPosition(lines, height);
  }

  protected resolveFakeCursors(lines: string[]): string[] {
    return resolveFakeCursors(lines, this.showHardwareCursor);
  }

  queryTerminalColors(options: TerminalColorQueryOptions): Promise<TerminalColors> {
    return this.colorQueries.query(options, (data) => this.terminal.write(data));
  }
}
