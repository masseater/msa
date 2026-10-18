import {
  type Component,
  type Focusable,
  getKeybindings,
  Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@msa/tui";
import { Effect } from "effect";

import { awaited, awaitingWith } from "../../../core/awaiting.ts";
import { formatAge, type MemoryService } from "../../../core/memory/memory.ts";
import type { MemoryKind, MemoryRecord } from "../../../core/memory/store.ts";
import { toErrorMessage } from "../../../utils/errors.ts";
import { theme } from "../theme/theme.ts";
import { rawKeyHint } from "./keybinding-hints.ts";

const LIST_LIMIT = 200;

const SEARCH_LIMIT = 50;

const KIND_GLYPH: Record<MemoryKind, string> = {
  fact: "●",
  preference: "◆",
  decision: "▲",
  note: "○",
};

const KIND_COLOR: Record<MemoryKind, "accent" | "success" | "warning" | "muted"> = {
  fact: "accent",
  preference: "success",
  decision: "warning",
  note: "muted",
};

function glyph(record: MemoryRecord): string {
  return theme.fg(KIND_COLOR[record.kind], KIND_GLYPH[record.kind]);
}

function scopeLabel(record: MemoryRecord): string {
  return record.scope === "project" ? `project:${record.project ?? "?"}` : "global";
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

export interface MemoryViewOptions {
  service: MemoryService;
  onClose: () => void;
  confirm?: (message: string) => Promise<boolean>;
  onError: (message: string) => void;
  requestRender: () => void;
  maxHeight: () => number;
}

export class MemoryView implements Component, Focusable {
  private readonly options: MemoryViewOptions;
  private records: MemoryRecord[];
  private selectedId: string | undefined;
  private openId: string | undefined;
  private query: string | undefined;
  private busy = false;
  private inputMode: "search" | "add" | undefined;
  private readonly searchInput = new Input({ prompt: "› ", placeholder: "Search memories" });
  private readonly addInput = new Input({ prompt: "› ", placeholder: "Memory to remember" });
  private focusedState = false;

  constructor(options: MemoryViewOptions) {
    this.options = options;
    this.records = options.service.list(LIST_LIMIT);
    for (const input of [this.searchInput, this.addInput]) {
      input.onSubmit = (value) => this.submit(value);
      input.onEscape = () => this.stopInput();
    }
  }

  private activeInput(): Input {
    return this.inputMode === "add" ? this.addInput : this.searchInput;
  }

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value && this.inputMode === "search";
    this.addInput.focused = value && this.inputMode === "add";
  }

  invalidate(): void {}

  private rows(): MemoryRecord[] {
    return [
      ...this.records.filter((record) => record.scope === "project"),
      ...this.records.filter((record) => record.scope === "global"),
    ];
  }

  private selected(rows: readonly MemoryRecord[]): MemoryRecord | undefined {
    return rows.find((record) => record.id === this.selectedId) ?? rows[0];
  }

  private reload(): void {
    this.records = this.options.service.list(LIST_LIMIT);
  }

  render(width: number): string[] {
    const rows = this.rows();
    const open =
      this.openId !== undefined && this.openId !== ""
        ? rows.find((record) => record.id === this.openId)
        : undefined;
    const lines =
      open === undefined ? this.renderList(rows, width) : this.renderDetail(open, width);
    const max = Math.max(8, this.options.maxHeight());
    const hints = lines.pop() ?? "";
    return [...lines.slice(0, max - 1), hints];
  }

  private header(title: string, right: string, width: number): string[] {
    const gap = Math.max(1, width - 2 - visibleWidth(title) - visibleWidth(right));
    return [
      "",
      truncateToWidth(` ${theme.bold(title)}${" ".repeat(gap)}${right}`, width),
      theme.fg("borderMuted", "─".repeat(width)),
    ];
  }

  private describeCounts(): string {
    const stats = this.options.service.stats();
    const parts = [
      this.options.service.project,
      `${stats.total} ${stats.total === 1 ? "memory" : "memories"}`,
      `${stats.embedded} embedded`,
    ];
    return theme.fg("dim", parts.join(" · "));
  }

  private renderList(rows: readonly MemoryRecord[], width: number): string[] {
    const renderListLinesResult = MemoryView.renderListLines(this, width, rows);
    if (renderListLinesResult.done) return renderListLinesResult.value;
    const lines = renderListLinesResult.value;
    if (this.inputMode === "add") {
      lines.push(...this.addInput.render(width));
      lines.push(` ${rawKeyHint("enter", "save")}  ${rawKeyHint("esc", "cancel")}`);
      return lines;
    }
    const selected = this.selected(rows);
    lines.push(
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
    );
    return lines;
  }

  private static renderListLines(
    self: MemoryView,
    width: number,
    rows: readonly MemoryRecord[],
  ): { done: true; value: string[] } | { done: false; value: string[] } {
    const right =
      self.query === undefined ? self.describeCounts() : theme.fg("dim", `search: ${self.query}`);
    const lines = self.header("Memory", right, width);
    if (self.busy && rows.length === 0) {
      lines.push("", ` ${theme.fg("muted", "searching…")}`, "");
    } else if (rows.length === 0) {
      lines.push(
        "",
        ` ${theme.fg("muted", self.query === undefined ? "No memories stored yet." : "No matching memories.")}`,
        "",
      );
    } else {
      const selected = self.selected(rows);
      let group: string | undefined;
      for (const record of rows) {
        const label = record.scope === "project" ? `Project (${record.project ?? "?"})` : "Global";
        if (label !== group) {
          group = label;
          lines.push(theme.fg("muted", ` ${label}`));
        }
        const isSelected = record.id === selected?.id;
        const cursor = isSelected ? theme.fg("accent", "›") : " ";
        const content = isSelected
          ? theme.bold(firstLine(record.content))
          : firstLine(record.content);
        const meta = theme.fg("dim", formatAge(record.updatedAt));
        const left = ` ${cursor} ${glyph(record)} ${content}`;
        const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(meta) - 1);
        lines.push(truncateToWidth(`${left}${" ".repeat(gap)}${meta}`, width));
      }
      lines.push("");
    }
    if (self.inputMode === "search") {
      lines.push(...self.searchInput.render(width));
      lines.push(` ${rawKeyHint("enter", "search")}  ${rawKeyHint("esc", "cancel")}`);
      return { done: true, value: lines };
    }
    return { done: false, value: lines };
  }

  private renderDetail(record: MemoryRecord, width: number): string[] {
    const lines = this.header(
      `${glyph(record)} ${firstLine(record.content)}`,
      theme.fg("dim", `${record.kind} · ${scopeLabel(record)} · ${formatAge(record.updatedAt)}`),
      width,
    );
    lines.push(
      ...record.content
        .split("\n")
        .flatMap((line) => wrapTextWithAnsi(line, width - 4))
        .map((line) => `   ${line}`),
    );
    lines.push("", theme.fg("accent", " Details"));
    const detail = (label: string, value: string) => {
      const gap = Math.max(1, 12 - visibleWidth(label));
      lines.push(
        truncateToWidth(`   ${theme.fg("muted", label)}${" ".repeat(gap)}${value}`, width),
      );
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
    lines.push("");
    lines.push(` ${[rawKeyHint("d", "forget"), rawKeyHint("esc", "back")].join("  ")}`);
    return lines;
  }

  handleInput(data: string): void {
    if (this.inputMode !== undefined) {
      this.activeInput().handleInput(data);
      this.options.requestRender();
      return;
    }
    const kb = getKeybindings();
    const rows = this.rows();
    const selected =
      this.openId !== undefined && this.openId !== ""
        ? rows.find((record) => record.id === this.openId)
        : this.selected(rows);
    if (kb.matches(data, "tui.select.cancel")) {
      if (this.openId !== undefined && this.openId !== "") this.openId = undefined;
      else if (this.query === undefined) {
        this.options.onClose();
      } else {
        this.query = undefined;
        this.selectedId = undefined;
        this.reload();
      }
    } else if (
      (this.openId === undefined || this.openId === "") &&
      kb.matches(data, "tui.select.up")
    ) {
      this.move(rows, -1);
    } else if (
      (this.openId === undefined || this.openId === "") &&
      kb.matches(data, "tui.select.down")
    ) {
      this.move(rows, 1);
    } else if (
      kb.matches(data, "tui.select.confirm") &&
      selected !== undefined &&
      (this.openId === undefined || this.openId === "")
    ) {
      this.openId = selected.id;
    } else if (matchesKey(data, "/") && (this.openId === undefined || this.openId === "")) {
      this.startInput("search");
    } else if (matchesKey(data, "a") && (this.openId === undefined || this.openId === "")) {
      this.startInput("add");
    } else if (matchesKey(data, "d") && selected !== undefined) {
      void Effect.runFork(this.forget(selected));
    }
    this.options.requestRender();
  }

  private move(rows: readonly MemoryRecord[], step: number): void {
    if (rows.length === 0) return;
    const index = rows.findIndex((record) => record.id === this.selected(rows)?.id);
    this.selectedId = rows[(index + step + rows.length) % rows.length]?.id;
  }

  private startInput(mode: "search" | "add"): void {
    this.inputMode = mode;
    const input = this.activeInput();
    input.setValue("");
    input.focused = this.focusedState;
  }

  private stopInput(): void {
    this.inputMode = undefined;
    this.searchInput.focused = false;
    this.addInput.focused = false;
    this.options.requestRender();
  }

  private submit(value: string): void {
    const mode = this.inputMode;
    const text = value.trim();
    this.stopInput();
    if (mode === undefined || text === "") return;
    if (mode === "add") {
      this.busy = true;
      Effect.runFork(
        awaitingWith(function* () {
          try {
            yield* awaited(this.options.service.save({ content: text }));
            this.busy = false;
            this.reload();
            this.selectedId = undefined;
          } catch (error: unknown) {
            this.busy = false;
            this.options.onError(toErrorMessage(error));
          } finally {
            this.options.requestRender();
          }
        }, this),
      );
      return;
    }
    this.busy = true;
    this.query = text;
    Effect.runFork(
      awaitingWith(function* () {
        try {
          const scores = yield* awaited(this.options.service.search(text, SEARCH_LIMIT));
          this.busy = false;
          this.records = scores.map((scored) => scored.record);
          this.selectedId = undefined;
        } catch (error: unknown) {
          this.busy = false;
          this.options.onError(toErrorMessage(error));
        } finally {
          this.options.requestRender();
        }
      }, this),
    );
  }

  private forget(record: MemoryRecord): Effect.Effect<void> {
    return awaitingWith(function* () {
      const confirmed =
        this.options.confirm === undefined
          ? true
          : yield* awaited(this.options.confirm(`Forget "${firstLine(record.content)}"?`));
      if (!confirmed) return;
      this.options.service.forget(record.id);
      if (this.openId === record.id) this.openId = undefined;
      this.selectedId = undefined;
      this.reload();
      this.options.requestRender();
    }, this);
  }
}
