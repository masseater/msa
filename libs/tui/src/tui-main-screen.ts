import type tuiInterfaceTypes from "./tui-interface.types.ts";
import type tuiMainScreenFrameTypes from "./tui-main-screen-frame.types.ts";
import tuiMainScreenKit from "./tui-main-screen-kit.ts";
import type tuiMainScreenKittyTypes from "./tui-main-screen-kitty.types.ts";
import tuiMainScreenReports from "./tui-main-screen-reports.ts";
import tuiMainScreenSupport from "./tui-main-screen-support.ts";
import type tuiMainScreenSupportTypes from "./tui-main-screen-support.types.ts";
import type tuiMainScreenTypes from "./tui-main-screen.types.ts";
import TuiBase from "./tui.ts";

const { termuxSession, tuiMainScreenKitty } = tuiMainScreenKit;

const { isTermuxSession } = termuxSession;

const { env, terminalImageKitty, tuiMainScreenFrame } = tuiMainScreenKit;
const { readEnv } = env;

const { isImageLine } = terminalImageKitty;
const { fullRenderReason, overwideCrash, renderDebugLines } = tuiMainScreenReports;
const { changedRange, collectKittyImageIds, deleteChangedKittyImages, deleteKittyImages } =
  tuiMainScreenKitty;
const { BoundedTerminalWriter, appendRedrawLog, raiseRenderCrash, writeRenderDebugLog } =
  tuiMainScreenSupport;
const {
  appendChangedLines,
  appendFullRenderLines,
  appendTrailingClear,
  clearDeletedTail,
  hardwareCursorMove,
  moveToFirstChanged,
} = tuiMainScreenFrame;

export default class TuiMainScreen extends TuiBase implements tuiInterfaceTypes.TUI {
  readonly mode = "regular" as const;
  private previousLines: string[] = [];
  private previousKittyImageIds = new Set<number>();
  private previousWidth = 0;
  private previousHeight = 0;
  private cursorRow = 0;
  private hardwareCursorRow = 0;
  private maxLinesRendered = 0;
  private previousViewportTop = 0;

  captureRenderState(): tuiMainScreenTypes.TuiMainScreenRenderState {
    return {
      cursorRow: this.cursorRow,
      hardwareCursorRow: this.hardwareCursorRow,
      maxLinesRendered: this.maxLinesRendered,
      previousHeight: this.previousHeight,
      previousLines: [...this.previousLines],
      previousViewportTop: this.previousViewportTop,
      previousWidth: this.previousWidth,
    };
  }

  restoreRenderState(state: tuiMainScreenTypes.TuiMainScreenRenderState): void {
    this.previousLines = state.previousLines.map((line) => (isImageLine(line) ? "" : line));
    this.previousKittyImageIds = new Set();
    this.previousWidth = state.previousWidth;
    this.previousHeight = state.previousHeight;
    this.cursorRow = state.cursorRow;
    this.hardwareCursorRow = state.hardwareCursorRow;
    this.maxLinesRendered = state.maxLinesRendered;
    this.previousViewportTop = state.previousViewportTop;
  }

  protected override resetRenderState(): void {
    this.previousLines = [];
    this.previousWidth = -1;
    this.previousHeight = -1;
    this.cursorRow = 0;
    this.hardwareCursorRow = 0;
    this.maxLinesRendered = 0;
    this.previousViewportTop = 0;
  }

  protected override beforeTerminalStop(options: tuiInterfaceTypes.TuiStopOptions): void {
    if (options.preserveScreen === true || this.previousLines.length === 0) return;
    this.terminal.write(" ");
    const targetRow = this.previousLines.length;
    const lineDiff = targetRow - this.hardwareCursorRow;
    if (lineDiff > 0) this.terminal.write(`\x1b[${lineDiff}B`);
    else if (lineDiff < 0) this.terminal.write(`\x1b[${-lineDiff}A`);
    this.terminal.write("\r\n");
  }

  protected doRender(): void {
    if (this.stopped) return;
    const frame = this.prepareFrame();
    const reason = fullRenderReason(
      frame,
      {
        height: this.previousHeight,
        lineCount: this.previousLines.length,
        maxLinesRendered: this.maxLinesRendered,
        width: this.previousWidth,
      },
      {
        clearOnShrink: this.getClearOnShrink(),
        hasOverlays: this.hasOverlayEntries,
        termux: isTermuxSession(),
      },
    );
    if (reason !== undefined) {
      this.logRedraw(frame, reason.message);
      this.fullRender(frame, reason.clear);
      return;
    }

    const range = changedRange(this.previousLines, frame.newLines);
    if (range === undefined) {
      this.positionHardwareCursor(frame.cursorPos, frame.newLines.length);
      this.previousViewportTop = frame.prevViewportTop;
      this.previousHeight = frame.height;
      return;
    }

    if (range.firstChanged >= frame.newLines.length) {
      this.renderDeletedTail(frame, range);
      return;
    }

    if (range.firstChanged < frame.prevViewportTop) {
      this.logRedraw(
        frame,
        `firstChanged < viewportTop (${range.firstChanged} < ${frame.prevViewportTop})`,
      );
      this.fullRender(frame, true);
      return;
    }

    this.renderChangedLines(frame, range);
  }

  private prepareFrame(): tuiMainScreenFrameTypes.RenderFrame {
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;
    const previousBufferLength =
      this.previousHeight > 0 ? this.previousViewportTop + this.previousHeight : height;
    const prevViewportTop = heightChanged
      ? Math.max(0, previousBufferLength - height)
      : this.previousViewportTop;
    const hardwareCursorRow = this.hardwareCursorRow;

    let newLines = this.resolveFakeCursors(this.render(width));
    if (this.hasOverlayEntries) {
      newLines = this.compositeOverlays(newLines, width, height);
    }
    const cursorPos = this.extractCursorPosition(newLines, height);
    newLines = this.applyLineResets(newLines);

    return {
      cursorPos,
      hardwareCursorRow,
      height,
      newLines,
      prevViewportTop,
      viewportTop: prevViewportTop,
      width,
    };
  }

  private logRedraw(frame: tuiMainScreenFrameTypes.RenderFrame, reason: string): void {
    if (readEnv("MSA_TUI_DEBUG_REDRAW") !== "1" || this.logDirectory === undefined) return;
    appendRedrawLog(
      this.logDirectory,
      `${reason} (prev=${this.previousLines.length}, new=${frame.newLines.length}, height=${frame.height})`,
    );
  }

  private newWriter(): tuiMainScreenSupportTypes.BoundedTerminalWriter {
    return new BoundedTerminalWriter((data) => this.terminal.write(data));
  }

  private commitFrame(frame: tuiMainScreenFrameTypes.RenderFrame): void {
    this.previousLines = frame.newLines;
    this.previousKittyImageIds = collectKittyImageIds(frame.newLines);
    this.previousWidth = frame.width;
    this.previousHeight = frame.height;
  }

  private fullRender(frame: tuiMainScreenFrameTypes.RenderFrame, clear: boolean): void {
    const { newLines, height } = frame;
    this.fullRedrawCount += 1;
    const output = this.newWriter();
    output.append("\x1b[?2026h");
    if (clear) {
      output.append(deleteKittyImages(this.previousKittyImageIds));
      output.append("\x1b[2J\x1b[H\x1b[3J");
    }
    appendFullRenderLines(output, frame);
    output.append("\x1b[?2026l");
    output.flush();
    this.cursorRow = Math.max(0, newLines.length - 1);
    this.hardwareCursorRow = this.cursorRow;
    this.maxLinesRendered = clear
      ? newLines.length
      : Math.max(this.maxLinesRendered, newLines.length);
    const bufferLength = Math.max(height, newLines.length);
    this.previousViewportTop = Math.max(0, bufferLength - height);
    this.positionHardwareCursor(frame.cursorPos, newLines.length);
    this.commitFrame(frame);
  }

  private renderDeletedTail(
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
  ): void {
    if (this.previousLines.length > frame.newLines.length) {
      const output = this.newWriter();
      const outcome = clearDeletedTail(output, frame, this.previousLines, range);
      if (this.handleFallback(frame, outcome) || outcome.kind !== "done") return;
      output.flush();
      this.cursorRow = outcome.row;
      this.hardwareCursorRow = outcome.row;
    }
    this.positionHardwareCursor(frame.cursorPos, frame.newLines.length);
    this.commitFrame(frame);
    this.previousViewportTop = frame.prevViewportTop;
  }

  private failOnOverwideLine(frame: tuiMainScreenFrameTypes.RenderFrame, index: number): void {
    this.stop();
    void raiseRenderCrash(overwideCrash(frame, index, this.logDirectory));
  }

  private handleFallback(
    frame: tuiMainScreenFrameTypes.RenderFrame,
    outcome: tuiMainScreenFrameTypes.FrameOutcome,
  ): boolean {
    if (outcome.kind === "overwide") {
      this.failOnOverwideLine(frame, outcome.index);
      return true;
    }
    if (outcome.kind !== "fallback") return false;
    this.logRedraw(frame, outcome.reason);
    this.fullRender(frame, true);
    return true;
  }

  private renderChangedLines(
    frame: tuiMainScreenFrameTypes.RenderFrame,
    range: tuiMainScreenKittyTypes.ChangedRange,
  ): void {
    const { newLines, height } = frame;
    const output = this.newWriter();
    output.append("\x1b[?2026h");
    output.append(deleteChangedKittyImages(this.previousLines, range));
    const lineDiff = moveToFirstChanged(output, frame, range);
    const renderEnd = Math.min(range.lastChanged, newLines.length - 1);
    if (this.handleFallback(frame, appendChangedLines(output, frame, range, renderEnd))) return;
    const finalCursorRow = appendTrailingClear(output, frame, this.previousLines.length, renderEnd);
    output.append("\x1b[?2026l");
    if (readEnv("MSA_TUI_DEBUG") === "1") {
      writeRenderDebugLog(
        renderDebugLines(frame, range, {
          cursorRow: this.cursorRow,
          finalCursorRow,
          lineDiff,
          previousLines: this.previousLines,
          renderEnd,
          written: output.length,
        }),
      );
    }
    output.flush();

    this.cursorRow = Math.max(0, newLines.length - 1);
    this.hardwareCursorRow = finalCursorRow;
    this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
    this.previousViewportTop = Math.max(frame.prevViewportTop, finalCursorRow - height + 1);
    this.positionHardwareCursor(frame.cursorPos, newLines.length);
    this.commitFrame(frame);
  }

  private positionHardwareCursor(
    cursorPos: tuiMainScreenFrameTypes.CursorPosition | null,
    totalLines: number,
  ): void {
    if (cursorPos === null || totalLines <= 0) {
      this.terminal.hideCursor();
      return;
    }
    const move = hardwareCursorMove(this.hardwareCursorRow, cursorPos, totalLines);
    this.terminal.write(move.sequence);
    this.hardwareCursorRow = move.row;
    if (this.getShowHardwareCursor()) {
      this.terminal.showCursor();
    } else {
      this.terminal.hideCursor();
    }
  }
}
