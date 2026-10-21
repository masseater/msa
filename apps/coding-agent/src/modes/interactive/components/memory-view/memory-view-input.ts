import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../../../core/awaiting.ts";
import type storeTypes from "../../../../core/memory/store.types.ts";
import errors from "../../../../utils/errors.ts";
import memoryViewHelpers from "../memory-view-helpers.ts";
import type MemoryView from "../memory-view.ts";

const { getKeybindings, matchesKey } = tui;
const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errors;
const { SEARCH_LIMIT, firstLine } = memoryViewHelpers;

export default class MemoryViewInput {
  private readonly view: MemoryView;

  constructor(view: MemoryView) {
    this.view = view;
  }

  activeInput(): tuiTypes.Input {
    return this.view.inputMode === "add" ? this.view.addInput : this.view.searchInput;
  }

  back() {
    if (this.view.openId !== undefined && this.view.openId !== "") this.openDetail(undefined);
    else if (this.view.query === undefined) {
      this.view.options.onClose();
    } else {
      this.view.query = undefined;
      this.view.selectedId = undefined;
      this.view.reload();
    }
  }

  handle(data: string): void {
    const { view } = this;
    if (view.inputMode !== undefined) {
      this.activeInput().handleInput(data);
      view.options.requestRender();
      return;
    }
    const kb = getKeybindings();
    const rows = view.rows();
    const isOpen = view.openId !== undefined && view.openId !== "";
    const selected = isOpen
      ? rows.find((record) => record.id === view.openId)
      : view.selected(rows);
    const step = this.navigationStep(data, kb);
    if (kb.matches(data, "tui.select.cancel")) {
      this.back();
    } else if (step !== undefined && isOpen) {
      this.scrollBy(step.delta);
    } else if (step !== undefined) {
      if (step.single) this.move(rows, step.delta);
      else this.moveBy(rows, step.delta);
    } else if (!isOpen && kb.matches(data, "tui.select.confirm") && selected !== undefined) {
      this.openDetail(selected.id);
    } else if (!isOpen && matchesKey(data, "/")) {
      this.startInput("search");
    } else if (!isOpen && matchesKey(data, "a")) {
      this.startInput("add");
    } else if (matchesKey(data, "d") && selected !== undefined) {
      void this.forget(selected);
    }
    view.options.requestRender();
  }

  private navigationStep(
    data: string,
    kb: ReturnType<typeof getKeybindings>,
  ): { delta: number; single: boolean } | undefined {
    const page = Math.max(1, this.view.room - 1);
    const half = Math.max(1, Math.floor(this.view.room / 2));
    if (kb.matches(data, "tui.select.up")) return { delta: -1, single: true };
    if (kb.matches(data, "tui.select.down")) return { delta: 1, single: true };
    if (kb.matches(data, "tui.select.pageUp")) return { delta: -page, single: false };
    if (kb.matches(data, "tui.select.pageDown")) return { delta: page, single: false };
    if (matchesKey(data, "ctrl+u")) return { delta: -half, single: false };
    if (matchesKey(data, "ctrl+d")) return { delta: half, single: false };
    return undefined;
  }

  move(rows: readonly storeTypes.MemoryRecord[], step: number): void {
    if (rows.length === 0) return;
    const index = rows.findIndex((record) => record.id === this.view.selected(rows)?.id);
    this.view.selectedId = rows[(index + step + rows.length) % rows.length]?.id;
  }

  moveBy(rows: readonly storeTypes.MemoryRecord[], step: number): void {
    if (rows.length === 0) return;
    const index = rows.findIndex((record) => record.id === this.view.selected(rows)?.id);
    this.view.selectedId = rows[Math.max(0, Math.min(index + step, rows.length - 1))]?.id;
  }

  scrollBy(lines: number): void {
    this.view.scroll = Math.max(0, this.view.scroll + lines);
  }

  openDetail(id: string | undefined): void {
    this.view.openId = id;
    this.view.scroll = 0;
  }

  startInput(mode: "search" | "add"): void {
    this.view.inputMode = mode;
    const input = this.activeInput();
    input.setValue("");
    input.focused = this.view.focusedState;
  }

  stopInput(): void {
    this.view.inputMode = undefined;
    this.view.searchInput.focused = false;
    this.view.addInput.focused = false;
    this.view.options.requestRender();
  }

  submit(value: string): void {
    const mode = this.view.inputMode;
    const text = value.trim();
    this.stopInput();
    if (mode === undefined || text === "") return;
    if (mode === "add") {
      this.view.busy = true;
      void this.view.options.service
        .save({ content: text })
        .then(() => {
          this.view.busy = false;
          this.view.reload();
          this.view.selectedId = undefined;
          return undefined;
        })
        .catch((error: unknown) => {
          this.view.busy = false;
          this.view.options.onError(toErrorMessage(error));
        })
        .finally(() => this.view.options.requestRender());
      return;
    }
    this.view.busy = true;
    this.view.query = text;
    void this.view.options.service
      .search(text, SEARCH_LIMIT)
      .then((scores) => {
        this.view.busy = false;
        this.view.showRecords(scores.map((scored) => scored.record));
        this.view.selectedId = undefined;
        return undefined;
      })
      .catch((error: unknown) => {
        this.view.busy = false;
        this.view.options.onError(toErrorMessage(error));
      })
      .finally(() => this.view.options.requestRender());
  }

  forget(record: storeTypes.MemoryRecord): Promise<void> {
    return Effect.runPromise(
      awaitingWith(this)(function* () {
        const confirmed =
          this.view.options.confirm === undefined
            ? true
            : yield* awaited(this.view.options.confirm(`Forget "${firstLine(record.content)}"?`));
        if (!confirmed) return;
        this.view.options.service.forget(record.id);
        if (this.view.openId === record.id) this.openDetail(undefined);
        this.view.selectedId = undefined;
        this.view.reload();
        this.view.options.requestRender();
      }),
    );
  }
}
