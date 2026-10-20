import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type storeTypes from "../../../core/memory/store.types.ts";
import errors from "../../../utils/errors.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import memoryViewHelpers from "./memory-view-helpers.ts";
import MemoryViewLayer0 from "./memory-view-layer-0.ts";
import type scrollWindowTypes from "./scroll-window.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { getKeybindings, matchesKey, truncateToWidth, visibleWidth } = tui;
const { theme } = themeModule;
const { rawKeyHint } = keybindingHints;
const { toErrorMessage } = errors;
const { LIST_LIMIT, SEARCH_LIMIT, firstLine } = memoryViewHelpers;

export default abstract class MemoryViewLayer1 extends MemoryViewLayer0 {
  protected activeInput(): tuiTypes.Input {
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

  protected rows(): storeTypes.MemoryRecord[] {
    return [
      ...this.records.filter((record) => record.scope === "project"),
      ...this.records.filter((record) => record.scope === "global"),
    ];
  }

  protected selected(
    rows: readonly storeTypes.MemoryRecord[],
  ): storeTypes.MemoryRecord | undefined {
    return rows.find((record) => record.id === this.selectedId) ?? rows[0];
  }

  protected reload(): void {
    this.records = this.options.service.list(LIST_LIMIT);
  }

  header(title: string, right: string, width: number): string[] {
    const gap = Math.max(1, width - 2 - visibleWidth(title) - visibleWidth(right));
    return [
      "",
      truncateToWidth(` ${theme.bold(title)}${" ".repeat(gap)}${right}`, width),
      theme.fg("borderMuted", "─".repeat(width)),
    ];
  }

  protected describeCounts(): string {
    const stats = this.options.service.stats();
    const parts = [
      this.options.service.project,
      `${stats.total} ${stats.total === 1 ? "memory" : "memories"}`,
      `${stats.embedded} embedded`,
    ];
    return theme.fg("dim", parts.join(" · "));
  }

  protected renderListPart2(
    body: string[],
    width: number,
    header: string[],
  ): scrollWindowTypes.ViewFrame {
    return {
      body,
      footer: [
        "",
        ...this.searchInput.render(width),
        ` ${rawKeyHint("enter", "search")}  ${rawKeyHint("esc", "cancel")}`,
      ],
      header,
    };
  }

  handleInput(data: string): void {
    if (this.inputMode !== undefined) {
      this.activeInput().handleInput(data);
      this.options.requestRender();
      return;
    }
    const { kb, page, half, rows, selected } = this.handleInputPart1();
    if (kb.matches(data, "tui.select.cancel")) {
      this.handleInputPart2();
    } else if (
      this.openId !== undefined &&
      this.openId !== "" &&
      kb.matches(data, "tui.select.up")
    ) {
      this.scrollBy(-1);
    } else if (
      this.openId !== undefined &&
      this.openId !== "" &&
      kb.matches(data, "tui.select.down")
    ) {
      this.scrollBy(1);
    } else if (
      this.openId !== undefined &&
      this.openId !== "" &&
      kb.matches(data, "tui.select.pageUp")
    ) {
      this.scrollBy(-page);
    } else if (
      this.openId !== undefined &&
      this.openId !== "" &&
      kb.matches(data, "tui.select.pageDown")
    ) {
      this.scrollBy(page);
    } else if (this.openId !== undefined && this.openId !== "" && matchesKey(data, "ctrl+u")) {
      this.scrollBy(-half);
    } else if (this.openId !== undefined && this.openId !== "" && matchesKey(data, "ctrl+d")) {
      this.scrollBy(half);
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
      (this.openId === undefined || this.openId === "") &&
      kb.matches(data, "tui.select.pageUp")
    ) {
      this.moveBy(rows, -page);
    } else if (
      (this.openId === undefined || this.openId === "") &&
      kb.matches(data, "tui.select.pageDown")
    ) {
      this.moveBy(rows, page);
    } else if ((this.openId === undefined || this.openId === "") && matchesKey(data, "ctrl+u")) {
      this.moveBy(rows, -half);
    } else if ((this.openId === undefined || this.openId === "") && matchesKey(data, "ctrl+d")) {
      this.moveBy(rows, half);
    } else if (
      kb.matches(data, "tui.select.confirm") &&
      selected !== undefined &&
      (this.openId === undefined || this.openId === "")
    ) {
      this.openDetail(selected.id);
    } else if (matchesKey(data, "/") && (this.openId === undefined || this.openId === "")) {
      this.startInput("search");
    } else if (matchesKey(data, "a") && (this.openId === undefined || this.openId === "")) {
      this.startInput("add");
    } else if (matchesKey(data, "d") && selected !== undefined) {
      void this.forget(selected);
    }
    this.options.requestRender();
  }

  protected handleInputPart2() {
    if (this.openId !== undefined && this.openId !== "") this.openDetail(undefined);
    else if (this.query === undefined) {
      this.options.onClose();
    } else {
      this.query = undefined;
      this.selectedId = undefined;
      this.reload();
    }
  }

  protected handleInputPart1() {
    const kb = getKeybindings();
    const rows = this.rows();
    const selected =
      this.openId !== undefined && this.openId !== ""
        ? rows.find((record) => record.id === this.openId)
        : this.selected(rows);
    const page = Math.max(1, this.room - 1);
    const half = Math.max(1, Math.floor(this.room / 2));
    return { half, kb, page, rows, selected };
  }

  protected move(rows: readonly storeTypes.MemoryRecord[], step: number): void {
    if (rows.length === 0) return;
    const index = rows.findIndex((record) => record.id === this.selected(rows)?.id);
    this.selectedId = rows[(index + step + rows.length) % rows.length]?.id;
  }

  protected moveBy(rows: readonly storeTypes.MemoryRecord[], step: number): void {
    if (rows.length === 0) return;
    const index = rows.findIndex((record) => record.id === this.selected(rows)?.id);
    this.selectedId = rows[Math.max(0, Math.min(index + step, rows.length - 1))]?.id;
  }

  protected scrollBy(lines: number): void {
    this.scroll = Math.max(0, this.scroll + lines);
  }

  protected openDetail(id: string | undefined): void {
    this.openId = id;
    this.scroll = 0;
  }

  protected startInput(mode: "search" | "add"): void {
    this.inputMode = mode;
    const input = this.activeInput();
    input.setValue("");
    input.focused = this.focusedState;
  }

  protected stopInput(): void {
    this.inputMode = undefined;
    this.searchInput.focused = false;
    this.addInput.focused = false;
    this.options.requestRender();
  }

  protected submit(value: string): void {
    const mode = this.inputMode;
    const text = value.trim();
    this.stopInput();
    if (mode === undefined || text === "") return;
    if (mode === "add") {
      this.busy = true;
      void this.options.service
        .save({ content: text })
        .then(() => {
          this.busy = false;
          this.reload();
          this.selectedId = undefined;
          return undefined;
        })
        .catch((error: unknown) => {
          this.busy = false;
          this.options.onError(toErrorMessage(error));
        })
        .finally(() => this.options.requestRender());
      return;
    }
    this.busy = true;
    this.query = text;
    void this.options.service
      .search(text, SEARCH_LIMIT)
      .then((scores) => {
        this.busy = false;
        this.records = scores.map((scored) => scored.record);
        this.selectedId = undefined;
        return undefined;
      })
      .catch((error: unknown) => {
        this.busy = false;
        this.options.onError(toErrorMessage(error));
      })
      .finally(() => this.options.requestRender());
  }

  forget(record: storeTypes.MemoryRecord): Promise<void> {
    return Effect.runPromise(
      awaitingWith(this)(function* () {
        const confirmed =
          this.options.confirm === undefined
            ? true
            : yield* awaited(this.options.confirm(`Forget "${firstLine(record.content)}"?`));
        if (!confirmed) return;
        this.options.service.forget(record.id);
        if (this.openId === record.id) this.openDetail(undefined);
        this.selectedId = undefined;
        this.reload();
        this.options.requestRender();
      }),
    );
  }
}
