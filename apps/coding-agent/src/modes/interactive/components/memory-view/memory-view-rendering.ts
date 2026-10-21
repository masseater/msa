import tui from "@msa/tui";

import type storeTypesTypes from "../../../../core/memory/store-types.types.ts";
import type storeTypes from "../../../../core/memory/store.types.ts";
import textModule from "../../../../utils/text.ts";
import themeModule from "../../theme/theme.ts";
import keybindingHints from "../keybinding-hints.ts";
import memoryViewHelpers from "../memory-view-helpers.ts";
import type MemoryView from "../memory-view.ts";
import type scrollWindowTypes from "../scroll-window.types.ts";

const { truncateToWidth, visibleWidth, wrapTextWithAnsi } = tui;
const { theme } = themeModule;
const { rawKeyHint } = keybindingHints;
const { firstLine, glyph, scopeLabel } = memoryViewHelpers;
const { formatAge } = textModule;

export default class MemoryViewRendering {
  private readonly view: MemoryView;

  constructor(view: MemoryView) {
    this.view = view;
  }

  header(title: string, right: string, width: number): string[] {
    const gap = Math.max(1, width - 2 - visibleWidth(title) - visibleWidth(right));
    return [
      "",
      truncateToWidth(` ${theme.bold(title)}${" ".repeat(gap)}${right}`, width),
      theme.fg("borderMuted", "─".repeat(width)),
    ];
  }

  private describeCounts(): string {
    const stats = this.view.options.service.stats();
    const parts = [
      this.view.options.service.project,
      `${stats.total} ${stats.total === 1 ? "memory" : "memories"}`,
      `${stats.embedded} embedded`,
    ];
    return theme.fg("dim", parts.join(" · "));
  }

  private renderSearchLine(
    body: string[],
    width: number,
    header: string[],
  ): scrollWindowTypes.ViewFrame {
    return {
      body,
      footer: [
        "",
        ...this.view.searchInput.render(width),
        ` ${rawKeyHint("enter", "search")}  ${rawKeyHint("esc", "cancel")}`,
      ],
      header,
    };
  }

  renderList(rows: readonly storeTypes.MemoryRecord[], width: number): scrollWindowTypes.ViewFrame {
    const right =
      this.view.query === undefined
        ? this.describeCounts()
        : theme.fg("dim", `search: ${this.view.query}`);
    const header = this.header("Memory", right, width);
    const selected = this.view.selected(rows);
    let { body, cursorLine } = this.renderRecordRows(rows, selected, width);
    if (this.view.inputMode === "search") {
      return this.renderSearchLine(body, width, header);
    }
    if (this.view.inputMode === "add") {
      return {
        body,
        footer: [
          "",
          ...this.view.addInput.render(width),
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

  private renderRecordRows(
    rows: readonly storeTypesTypes.MemoryRecord[],
    selected: storeTypesTypes.MemoryRecord | undefined,
    width: number,
  ) {
    const body: string[] = [];
    let cursorLine: number | undefined;
    if (this.view.busy && rows.length === 0) {
      body.push("", ` ${theme.fg("muted", "searching…")}`);
    } else if (rows.length === 0) {
      body.push(
        "",
        ` ${theme.fg("muted", this.view.query === undefined ? "No memories stored yet." : "No matching memories.")}`,
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

  renderDetail(record: storeTypes.MemoryRecord, width: number): scrollWindowTypes.ViewFrame {
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
