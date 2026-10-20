import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import truncate from "../../../core/tools/truncate.ts";
import type truncateTypes from "../../../core/tools/truncate.types.ts";
import ansi from "../../../utils/ansi.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import keybindingHints from "./keybinding-hints.ts";
import visualTruncate from "./visual-truncate.ts";

const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } = truncate;
const { theme } = themeModule;
const { keyHint, keyText } = keybindingHints;
const { stripAnsi } = ansi;
const { truncateToVisualLines } = visualTruncate;

const { Container, Loader, Spacer, Text } = tui;

const PREVIEW_LINES = 20;

export default class BashExecutionComponent extends tui.Container {
  private command: string;
  private outputLines: string[] = [];
  private status: "running" | "complete" | "cancelled" | "error" = "running";
  private exitCode: number | undefined = undefined;
  private loader: tuiTypes.Loader;
  private truncationResult?: truncateTypes.TruncationResult | undefined;
  private fullOutputPath?: string | undefined;
  private expanded = false;
  private contentContainer: tuiTypes.Container;
  private readonly colorKey: "dim" | "bashMode";
  private outputPad: number;

  constructor(command: string, ui: tuiTypes.TUI, excludeFromContext = false, outputPad = 1) {
    super();
    this.command = command;
    this.colorKey = excludeFromContext ? "dim" : "bashMode";
    this.outputPad = outputPad;
    const borderColor = (str: string) => theme.fg(this.colorKey, str);

    this.addChild(new Spacer(1));

    this.addChild(new DynamicBorder(borderColor));

    this.contentContainer = new Container();
    this.addChild(this.contentContainer);

    this.loader = new Loader(
      ui,
      (spinner) => theme.fg(this.colorKey, spinner),
      (text) => theme.fg("muted", text),
      `Running... (${keyText("tui.select.cancel")} to cancel)`,
    );

    this.addChild(new DynamicBorder(borderColor));

    this.updateDisplay();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.updateDisplay();
  }

  setOutputPad(outputPad: number): void {
    this.outputPad = outputPad;
    this.updateDisplay();
  }

  override invalidate(): void {
    super.invalidate();
    this.updateDisplay();
  }

  appendOutput(chunk: string): void {
    const clean = stripAnsi(chunk).replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");

    const newLines = clean.split("\n");
    const lastIndex = this.outputLines.length - 1;
    const lastLine = this.outputLines[lastIndex];
    const [firstNewLine, ...moreNewLines] = newLines;
    if (lastLine !== undefined && firstNewLine !== undefined) {
      this.outputLines[lastIndex] = lastLine + firstNewLine;
      this.outputLines.push(...moreNewLines);
    } else {
      this.outputLines.push(...newLines);
    }

    this.updateDisplay();
  }

  setComplete(
    exitCode: number | undefined,
    cancelled: boolean,
    truncationResult?: truncateTypes.TruncationResult,
    fullOutputPath?: string,
  ): void {
    this.exitCode = exitCode;
    this.status = cancelled
      ? "cancelled"
      : exitCode !== 0 && exitCode !== undefined && exitCode !== null
        ? "error"
        : "complete";
    this.truncationResult = truncationResult;
    this.fullOutputPath = fullOutputPath;

    this.loader.stop();

    this.updateDisplay();
  }

  private updateDisplay(): void {
    const fullOutput = this.outputLines.join("\n");
    const contextTruncation = truncateTail(fullOutput, {
      maxBytes: DEFAULT_MAX_BYTES,
      maxLines: DEFAULT_MAX_LINES,
    });

    const availableLines =
      contextTruncation.content === "" ? [] : contextTruncation.content.split("\n");

    const previewLogicalLines = availableLines.slice(-PREVIEW_LINES);
    const hiddenLineCount = availableLines.length - previewLogicalLines.length;

    this.contentContainer.clear();

    const header = new Text(
      theme.fg(this.colorKey, theme.bold(`$ ${this.command}`)),
      this.outputPad,
      0,
    );
    this.contentContainer.addChild(header);

    BashExecutionComponent.updateDisplayPart1(this, availableLines, previewLogicalLines);

    BashExecutionComponent.updateDisplayPart2(this, hiddenLineCount, contextTruncation);
  }

  private static updateDisplayPart1(
    self: BashExecutionComponent,
    availableLines: string[],
    previewLogicalLines: string[],
  ): void {
    if (availableLines.length > 0) {
      if (self.expanded) {
        const displayText = availableLines.map((line) => theme.fg("muted", line)).join("\n");
        self.contentContainer.addChild(new Text(`\n${displayText}`, self.outputPad, 0));
      } else {
        const styledOutput = previewLogicalLines.map((line) => theme.fg("muted", line)).join("\n");
        const styledInput = `\n${styledOutput}`;
        let cachedWidth: number | undefined;
        let cachedLines: string[] | undefined;
        self.contentContainer.addChild({
          invalidate: () => {
            cachedWidth = undefined;
            cachedLines = undefined;
          },
          render: (width: number) => {
            if (cachedLines === undefined || cachedWidth !== width) {
              const result = truncateToVisualLines(
                styledInput,
                PREVIEW_LINES,
                width,
                self.outputPad,
              );
              cachedLines = result.visualLines;
              cachedWidth = width;
            }
            return cachedLines ?? [];
          },
        });
      }
    }
  }

  private static updateDisplayPart2(
    self: BashExecutionComponent,
    hiddenLineCount: number,
    contextTruncation: truncateTypes.TruncationResult,
  ): void {
    if (self.status === "running") {
      self.contentContainer.addChild(self.loader);
    } else {
      const statusParts: string[] = [];

      if (hiddenLineCount > 0) {
        if (self.expanded) {
          statusParts.push(
            `${theme.fg("muted", "(")}${keyHint("app.tools.expand", "to collapse")}${theme.fg("muted", ")")}`,
          );
        } else {
          statusParts.push(
            `${theme.fg("muted", `... ${hiddenLineCount} more lines (`)}${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`,
          );
        }
      }

      if (self.status === "cancelled") {
        statusParts.push(theme.fg("warning", "(cancelled)"));
      } else if (self.status === "error") {
        statusParts.push(theme.fg("error", `(exit ${self.exitCode})`));
      }

      const wasTruncated = self.truncationResult?.truncated || contextTruncation.truncated;
      if (wasTruncated && self.fullOutputPath !== undefined && self.fullOutputPath !== "") {
        statusParts.push(
          theme.fg("warning", `Output truncated. Full output: ${self.fullOutputPath}`),
        );
      }

      if (statusParts.length > 0) {
        self.contentContainer.addChild(new Text(`\n${statusParts.join("\n")}`, self.outputPad, 0));
      }
    }
  }

  getOutput(): string {
    return this.outputLines.join("\n");
  }

  getCommand(): string {
    return this.command;
  }
}
