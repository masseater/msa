import { Input } from "./components/input.ts";
import { getKeybindings } from "./keybindings.ts";
import { truncateToWidth } from "./text-truncate.ts";
import type { Component, Focusable } from "./tui-component.ts";
import { visibleWidth } from "./utils.ts";

const OUTER_GAP_WIDTH = 1;

interface NavigationButtons {
  previous: string;
  next: string;
  separator: string;
  width: number;
}

interface NavigationLayout {
  rendered: string;
  leftRuleWidth: number;
  rightRuleWidth: number;
}

function formatKey(key: string | undefined): string {
  return key !== undefined && key !== ""
    ? key
        .split("+")
        .map((part) => {
          if (process.platform === "darwin" && part.toLowerCase() === "alt") return "Option";
          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join("+")
    : "Unbound";
}

function navigationButtons(previous: string, next: string, separator: string): NavigationButtons {
  return {
    previous,
    next,
    separator,
    width: visibleWidth(previous) + visibleWidth(separator) + visibleWidth(next),
  };
}

function fitNavigationButtons(availableWidth: number): NavigationButtons {
  const keybindings = getKeybindings();
  const previousKey = formatKey(keybindings.getKeys("tui.altScreen.searchPrevious")[0]);
  const nextKey = formatKey(keybindings.getKeys("tui.altScreen.searchNext")[0]);
  const labelled = navigationButtons(`↑ ${previousKey}`, `↓ ${nextKey}`, " · ");
  return labelled.width > availableWidth ? navigationButtons("↑", "↓", " ") : labelled;
}

export class AltScreenSearchComponent implements Component, Focusable {
  private readonly input = new Input({
    prompt: " ",
    placeholder: "Find in transcript",
    placeholderStyle: (text) => `\x1b[2m${text}\x1b[22m`,
  });
  private readonly onQueryChange: (query: string) => void;
  private readonly navigationButtonStyle: (text: string, hovered: boolean) => string;
  private resultCount = 0;
  private resultIndex = -1;
  private previousButtonStart = -1;
  private previousButtonEnd = -1;
  private nextButtonStart = -1;
  private nextButtonEnd = -1;
  private hoveredNavigationDirection: -1 | 1 | undefined;
  #focused = false;

  constructor(
    onQueryChange: (query: string) => void,
    navigationButtonStyle: (text: string, hovered: boolean) => string = (text) => text,
  ) {
    this.onQueryChange = onQueryChange;
    this.navigationButtonStyle = navigationButtonStyle;
  }

  get focused(): boolean {
    return this.#focused;
  }

  set focused(value: boolean) {
    this.#focused = value;
    this.input.focused = value;
  }

  setResult(index: number, count: number): void {
    this.resultIndex = index;
    this.resultCount = count;
  }

  getNavigationDirectionAt(row: number, column: number): -1 | 1 | undefined {
    if (row !== 2) return undefined;
    if (column >= this.previousButtonStart && column < this.previousButtonEnd) return -1;
    if (column >= this.nextButtonStart && column < this.nextButtonEnd) return 1;
    return undefined;
  }

  setHoveredNavigationDirection(direction: -1 | 1 | undefined): boolean {
    if (direction === this.hoveredNavigationDirection) return false;
    this.hoveredNavigationDirection = direction;
    return true;
  }

  handleInput(data: string): void {
    const previous = this.input.getValue();
    this.input.handleInput(data);
    const query = this.input.getValue();
    if (query !== previous) this.onQueryChange(query);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const innerWidth = Math.max(0, safeWidth - 2);
    const content = this.renderContent(innerWidth);
    const navigation = this.layoutNavigation(innerWidth);

    if (safeWidth === 1) return ["┌", "│", "└"];
    const gap = navigation.rendered === "" ? "" : " ";
    return [
      `┌${"─".repeat(innerWidth)}┐`,
      `│${content}│`,
      `└${"─".repeat(navigation.leftRuleWidth)}${gap}${navigation.rendered}${gap}${"─".repeat(navigation.rightRuleWidth)}┘`,
    ];
  }

  private resultLabel(query: string): string {
    if (query === "") return "";
    return this.resultCount === 0 ? "No matches" : `${this.resultIndex + 1}/${this.resultCount}`;
  }

  private renderContent(innerWidth: number): string {
    const result = this.resultLabel(this.input.getValue());
    const visibleResult = truncateToWidth(result, Math.max(0, innerWidth - 3), "");
    const resultText = visibleResult === "" ? "" : `\x1b[2m ${visibleResult} \x1b[22m`;
    const inputWidth = Math.max(0, innerWidth - visibleWidth(resultText));
    const inputLine = truncateToWidth(
      this.input.render(Math.max(1, inputWidth))[0] ?? "",
      inputWidth,
      "",
    );
    const inputPadding = " ".repeat(Math.max(0, inputWidth - visibleWidth(inputLine)));
    return `${inputLine}${inputPadding}${resultText}`;
  }

  private layoutNavigation(innerWidth: number): NavigationLayout {
    const availableControlsWidth = Math.max(0, innerWidth - OUTER_GAP_WIDTH * 2 - 1);
    const buttons = fitNavigationButtons(availableControlsWidth);
    const showButtons = buttons.width <= availableControlsWidth;
    const rendered = showButtons
      ? this.navigationButtonStyle(buttons.previous, this.hoveredNavigationDirection === -1) +
        buttons.separator +
        this.navigationButtonStyle(buttons.next, this.hoveredNavigationDirection === 1)
      : "";
    const outerGapsWidth = showButtons ? OUTER_GAP_WIDTH * 2 : 0;
    const rightRuleWidth = rendered !== "" && innerWidth > buttons.width + outerGapsWidth ? 1 : 0;
    const leftRuleWidth = Math.max(
      0,
      innerWidth - (showButtons ? buttons.width : 0) - outerGapsWidth - rightRuleWidth,
    );
    this.placeButtons(showButtons ? 1 + leftRuleWidth + OUTER_GAP_WIDTH : undefined, buttons);
    return { rendered, leftRuleWidth, rightRuleWidth };
  }

  private placeButtons(previousStart: number | undefined, buttons: NavigationButtons): void {
    if (previousStart === undefined) {
      this.previousButtonStart = -1;
      this.previousButtonEnd = -1;
      this.nextButtonStart = -1;
      this.nextButtonEnd = -1;
      return;
    }
    this.previousButtonStart = previousStart;
    this.previousButtonEnd = previousStart + visibleWidth(buttons.previous);
    this.nextButtonStart = this.previousButtonEnd + visibleWidth(buttons.separator);
    this.nextButtonEnd = this.nextButtonStart + visibleWidth(buttons.next);
  }
}
