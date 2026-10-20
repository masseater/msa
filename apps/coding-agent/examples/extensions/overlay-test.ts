import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@msa/coding-agent";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

const { CURSOR_MARKER, matchesKey, renderFakeCursor, visibleWidth } = tui;

export default function (msa: ExtensionAPI) {
  msa.registerCommand("overlay-test", {
    description: "Test overlay rendering with edge cases",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* Effect.promise(() =>
            ctx.ui.custom<{ action: string; query?: string } | undefined>(
              (_tui, theme, _keybindings, done) => new OverlayTestComponent(theme, done),
              { overlay: true },
            ),
          );

          if (result !== undefined) {
            const msg =
              result.query !== undefined && result.query.length > 0
                ? `${result.action}: "${result.query}"`
                : result.action;
            ctx.ui.notify(msg, "info");
          }
        }),
      ),
  });
}

interface OverlayItem {
  label: string;
  hasInput: boolean;
  text: string;
  cursor: number;
}

const renderItem = (
  item: OverlayItem,
  isSelected: boolean,
  focused: boolean,
  th: Theme,
): string => {
  const prefix = isSelected ? " ▶ " : "   ";

  if (!item.hasInput) {
    return prefix + (isSelected ? th.fg("accent", item.label) : th.fg("text", item.label));
  }

  const label = isSelected ? th.fg("accent", `${item.label}:`) : th.fg("text", `${item.label}:`);
  let inputDisplay = item.text;
  if (isSelected) {
    const before = inputDisplay.slice(0, item.cursor);
    const cursorChar = inputDisplay[item.cursor] ?? " ";
    const after = inputDisplay.slice(item.cursor + 1);
    const marker = focused ? CURSOR_MARKER : "";
    inputDisplay = `${before}${marker}${renderFakeCursor(cursorChar)}${after}`;
  }
  return `${prefix + label} ${inputDisplay}`;
};

class OverlayTestComponent implements tuiTypes.Focusable {
  readonly width = 70;

  focused = false;

  private selected = 0;
  private items = [
    { cursor: 0, hasInput: true, label: "Search", text: "" },
    { cursor: 0, hasInput: true, label: "Run", text: "" },
    { cursor: 0, hasInput: false, label: "Settings", text: "" },
    { cursor: 0, hasInput: false, label: "Cancel", text: "" },
  ];

  private theme: Theme;
  private done: (result: { action: string; query?: string } | undefined) => void;

  constructor(
    theme: Theme,
    done: (result: { action: string; query?: string } | undefined) => void,
  ) {
    this.theme = theme;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.done(undefined);
      return;
    }

    const current = this.items[this.selected]!;

    if (matchesKey(data, "return")) {
      this.done({ action: current.label, ...(current.hasInput ? { query: current.text } : {}) });
      return;
    }

    if (matchesKey(data, "up")) {
      this.selected = Math.max(0, this.selected - 1);
    } else if (matchesKey(data, "down")) {
      this.selected = Math.min(this.items.length - 1, this.selected + 1);
    } else if (current.hasInput) {
      if (matchesKey(data, "backspace")) {
        if (current.cursor > 0) {
          current.text =
            current.text.slice(0, current.cursor - 1) + current.text.slice(current.cursor);
          current.cursor--;
        }
      } else if (matchesKey(data, "left")) {
        current.cursor = Math.max(0, current.cursor - 1);
      } else if (matchesKey(data, "right")) {
        current.cursor = Math.min(current.text.length, current.cursor + 1);
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        current.text =
          current.text.slice(0, current.cursor) + data + current.text.slice(current.cursor);
        current.cursor++;
      }
    }
  }

  render(_width: number): string[] {
    const w = this.width;
    const th = this.theme;
    const innerW = w - 2;
    const lines: string[] = [];

    const pad = (s: string, len: number) => {
      const vis = visibleWidth(s);
      return s + " ".repeat(Math.max(0, len - vis));
    };

    const row = (content: string) =>
      th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");

    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(row(` ${th.fg("accent", "🧪 Overlay Test")}`));
    lines.push(row(""));

    lines.push(row(` ${th.fg("dim", "─── Edge Cases (borders should align) ───")}`));
    lines.push(
      row(
        ` Wide: ${th.fg("warning", "中文日本語한글テスト漢字繁體简体ひらがなカタカナ가나다라마바")}`,
      ),
    );
    lines.push(
      row(
        ` Styled: ${th.fg("error", "RED")} ${th.fg("success", "GREEN")} ${th.fg("warning", "YELLOW")} ${th.fg("accent", "ACCENT")} ${th.fg("dim", "DIM")} ${th.fg("error", "more")} ${th.fg("success", "colors")}`,
      ),
    );
    lines.push(row(" Emoji: 👨‍👩‍👧‍👦 🇯🇵 🚀 💻 🎉 🔥 😀 🎯 🌟 💡 🎨 🔧 📦 🏆 🌈 🎪 🎭 🎬 🎮 🎲"));
    lines.push(row(""));

    lines.push(row(` ${th.fg("dim", "─── Actions ───")}`));

    for (let i = 0; i < this.items.length; i++) {
      lines.push(row(renderItem(this.items[i]!, i === this.selected, this.focused, th)));
    }

    lines.push(row(""));
    lines.push(row(` ${th.fg("dim", "↑↓ navigate • type to input • Enter select • Esc cancel")}`));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}
