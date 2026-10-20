import tui from "@msa/tui";

import type storeTypesTypes from "../../../core/memory/store-types.types.ts";
import type storeTypes from "../../../core/memory/store.types.ts";
import textModule from "../../../utils/text.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import memoryViewHelpers from "./memory-view-helpers.ts";
import MemoryViewLayer1 from "./memory-view-layer-1.ts";
import type MemoryView from "./memory-view.ts";
import scrollWindow from "./scroll-window.ts";
import type scrollWindowTypes from "./scroll-window.types.ts";

const { fitView } = scrollWindow;
const { theme } = themeModule;
const { rawKeyHint } = keybindingHints;
const { formatAge } = textModule;
const { truncateToWidth, visibleWidth, wrapTextWithAnsi } = tui;
const { firstLine, glyph, scopeLabel } = memoryViewHelpers;

export default abstract class MemoryViewLayer2 extends MemoryViewLayer1 {
  render(width: number): string[] {
    const rows = this.rows();
    const open =
      this.openId !== undefined && this.openId !== ""
        ? rows.find((record) => record.id === this.openId)
        : undefined;
    const frame =
      open === undefined ? this.renderList(rows, width) : this.renderDetail(open, width);
    const max = Math.max(8, this.options.maxHeight());
    const room = Math.max(0, max - frame.header.length - frame.footer.length);
    this.room = Math.min(room, frame.body.length);
    const fitted = fitView(frame, width, max, this.scroll);
    this.scroll = fitted.offset;
    return fitted.lines;
  }

  protected renderList(
    rows: readonly storeTypes.MemoryRecord[],
    width: number,
  ): scrollWindowTypes.ViewFrame {
    const right =
      this.query === undefined ? this.describeCounts() : theme.fg("dim", `search: ${this.query}`);
    const header = this.header("Memory", right, width);
    const selected = this.selected(rows);
    let { body, cursorLine }: ReturnType<MemoryView["renderListPart1"]> = this.renderListPart1(
      rows,
      selected,
      width,
    );
    if (this.inputMode === "search") {
      return this.renderListPart2(body, width, header);
    }
    if (this.inputMode === "add") {
      return {
        body,
        footer: [
          "",
          ...this.addInput.render(width),
          ` ${rawKeyHint("enter", "save")}  ${rawKeyHint("esc", "cancel")}`,
        ],
        header,
      };
    }
    return {
      body,
      cursorLine,
      footer: [
        "",
        ` ${[
          rawKeyHint("↑↓", "select"),
          rawKeyHint("enter", "open"),
          rawKeyHint("/", "search"),
          rawKeyHint("a", "add"),
          selected === undefined ? undefined : rawKeyHint("d", "forget"),
          rawKeyHint("esc", "close"),
        ]
          .filter(Boolean)
          .join("  ")}`,
      ],
      header,
    };
  }

  protected renderListPart1(
    rows: readonly storeTypesTypes.MemoryRecord[],
    selected: storeTypesTypes.MemoryRecord | undefined,
    width: number,
  ) {
    const body: string[] = [];
    let cursorLine: number | undefined;
    if (this.busy && rows.length === 0) {
      body.push("", ` ${theme.fg("muted", "searching…")}`);
    } else if (rows.length === 0) {
      body.push(
        "",
        ` ${theme.fg("muted", this.query === undefined ? "No memories stored yet." : "No matching memories.")}`,
      );
    } else {
      let group: string | undefined;
      for (const record of rows) {
        const label = record.scope === "project" ? `Project (${record.project ?? "?"})` : "Global";
        if (label !== group) {
          group = label;
          body.push(theme.fg("muted", ` ${label}`));
        }
        const isSelected = record.id === selected?.id;
        if (isSelected) cursorLine = body.length;
        const cursor = isSelected ? theme.fg("accent", "›") : " ";
        const content = isSelected
          ? theme.bold(firstLine(record.content))
          : firstLine(record.content);
        const meta = theme.fg("dim", formatAge(record.updatedAt));
        const left = ` ${cursor} ${glyph(record)} ${content}`;
        const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(meta) - 1);
        body.push(truncateToWidth(`${left}${" ".repeat(gap)}${meta}`, width));
      }
    }
    return { body, cursorLine };
  }

  protected renderDetail(
    record: storeTypes.MemoryRecord,
    width: number,
  ): scrollWindowTypes.ViewFrame {
    const header = this.header(
      `${glyph(record)} ${firstLine(record.content)}`,
      theme.fg("dim", `${record.kind} · ${scopeLabel(record)} · ${formatAge(record.updatedAt)}`),
      width,
    );
    const body = record.content
      .split("\n")
      .flatMap((line) => wrapTextWithAnsi(line, width - 4))
      .map((line) => `   ${line}`);
    body.push("", theme.fg("accent", " Details"));
    const detail = (label: string, value: string) => {
      const gap = Math.max(1, 12 - visibleWidth(label));
      body.push(truncateToWidth(`   ${theme.fg("muted", label)}${" ".repeat(gap)}${value}`, width));
    };
    detail("id", record.id);
    detail("kind", `${record.kind} · ${scopeLabel(record)}`);
    detail(
      "timestamps",
      `created ${formatAge(record.createdAt)} · updated ${formatAge(record.updatedAt)}`,
    );
    detail(
      "recalled",
      `${record.useCount} ${record.useCount === 1 ? "time" : "times"}${record.lastUsedAt !== null && record.lastUsedAt !== 0 ? ` · last ${formatAge(record.lastUsedAt)}` : ""}`,
    );
    detail("embedding", record.embeddingModel ?? "none (keyword search only)");
    return {
      body,
      footer: ["", ` ${[rawKeyHint("d", "forget"), rawKeyHint("esc", "back")].join("  ")}`],
      header,
    };
  }
}
