import {
  type Component,
  type Focusable,
  getKeybindings,
  Input,
  matchesKey,
  Spacer,
  truncateToWidth,
  visibleWidth,
} from "@msa/tui";

import type { Orchestrator } from "../../../core/orchestrator/orchestrator.ts";
import type { TaskSnapshot } from "../../../core/orchestrator/types.ts";
import { toErrorMessage } from "../../../utils/errors.ts";
import { shortId } from "../../../utils/text.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";
import { fitView, type ViewFrame } from "./scroll-window.ts";
import { taskList } from "./tasks-list.ts";
import { taskDetail } from "./tasks-view-detail.ts";
import { type TasksViewState, viewHelpers } from "./tasks-view-helpers.ts";

const { STATUS_LABEL, glyph, finished, stoppable, modelName, depthOf, roundTasks } = viewHelpers;
const { describeReplan } = viewHelpers;

type Composing =
  | { kind: "message"; taskId: string }
  | { kind: "note"; round: string }
  | { kind: "priority"; taskId: string }
  | { kind: "depends"; taskId: string }
  | { kind: "instruction"; taskId: string };

function composerLabel(composing: Composing): string {
  switch (composing.kind) {
    case "message":
      return "Message to this task";
    case "note":
      return `Shared note to round ${composing.round}`;
    case "priority":
      return "New priority";
    case "depends":
      return `Dependencies of ${composing.taskId}  +id  -id`;
    case "instruction":
      return `Instruction for ${composing.taskId}`;
  }
}

function parseDepends(text: string): { add: string[]; remove: string[] } {
  const add: string[] = [];
  const remove: string[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const id = token.replace(/^[+-]/, "");
    if (id === "") continue;
    if (token.startsWith("-")) remove.push(id);
    else add.push(id);
  }
  return { add, remove };
}

export interface TasksViewOptions {
  orchestrator: Orchestrator;
  onClose: () => void;
  onPickModel: (taskId: string) => void;
  onError: (message: string) => void;
  requestRender: () => void;
  maxHeight: () => number;
  state?: TasksViewState;
}

export class TasksView implements Component, Focusable {
  /** The view owns the paging keys while it is open, so they scroll it and not the transcript. */
  readonly wantsViewportKeys = true;
  private readonly options: TasksViewOptions;
  private openId: string | undefined;
  private readonly input = new Input({ prompt: "› " });
  private readonly state: TasksViewState;
  private composing: Composing | undefined;
  /** First body line drawn; the list follows the cursor, the detail follows the scroll keys. */
  private scroll = 0;
  /** Body rows the last frame had room for. */
  private room = 0;
  private isFocused = false;

  constructor(options: TasksViewOptions, initialId?: string) {
    this.options = options;
    this.state = options.state ?? viewHelpers.createTasksViewState();
    if (initialId !== undefined) this.state.selectedId = initialId;
    this.input.onSubmit = (value) => this.submit(value);
    this.input.onEscape = () => this.stopComposing();
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.input.focused = value && this.composing !== undefined;
  }

  invalidate(): void {}

  private tasks(): readonly TaskSnapshot[] {
    return this.options.orchestrator.snapshot.tasks;
  }

  private shownTasks(): TaskSnapshot[] {
    return taskList.shownTasks(this.options.orchestrator, this.state);
  }

  private selected(): TaskSnapshot | undefined {
    return taskList.selectedTask(this.options.orchestrator, this.state);
  }

  private header(title: string, right: string, width: number): string[] {
    const gap = Math.max(1, width - 2 - visibleWidth(title) - visibleWidth(right));
    return [
      ...new Spacer(1).render(width),
      truncateToWidth(` ${theme.bold(title)}${" ".repeat(gap)}${right}`, width),
      ...new DynamicBorder((line) => theme.fg("borderMuted", line)).render(width),
    ];
  }

  private rowLine(task: TaskSnapshot, selected: boolean, width: number): string {
    return taskList.taskRow(task, {
      selected,
      width,
      meta: (entry) =>
        [shortId(entry.id), modelName(entry.model ?? "default")].filter(Boolean).join("  "),
    });
  }

  render(width: number): string[] {
    const open =
      this.openId === undefined ? undefined : this.tasks().find((task) => task.id === this.openId);
    const frame = open === undefined ? this.renderList(width) : this.renderDetail(open, width);
    const max = Math.max(8, this.options.maxHeight());
    const room = Math.max(0, max - frame.header.length - frame.footer.length);
    this.room = Math.min(room, frame.body.length);
    const fitted = fitView(frame, width, max, this.scroll);
    this.scroll = fitted.offset;
    return fitted.lines;
  }

  private renderRound(
    round: { id: string; title: string },
    selected: TaskSnapshot | undefined,
    width: number,
  ): { lines: string[]; cursor?: { start: number; end: number } | undefined } {
    const tasks = this.tasks();
    const inRound = roundTasks(tasks, round.id);
    if (inRound.length === 0) return { lines: [] };
    const review = inRound.find((task) => task.kind === "review");
    const lines = [
      theme.fg(
        "muted",
        ` ${round.title}${review === undefined ? "" : `  ${glyph(review)} review ${review.status}`}`,
      ),
    ];
    const byId = new Map(inRound.map((task) => [task.id, task]));
    const shown = inRound.filter((task) => this.state.showFinished || !finished(task));
    const done = inRound.filter((task) => task.status === "completed").length;
    const stopped = inRound.filter((task) => task.status === "stopped").length;
    if (done + stopped > 0) {
      const counts = [
        done > 0 ? `${theme.fg("success", "✓")} ${done} done` : undefined,
        stopped > 0 ? `${theme.fg("dim", "■")} ${stopped} stopped` : undefined,
      ]
        .filter(Boolean)
        .join("  ");
      lines.push(
        truncateToWidth(
          `   ${counts}  ${keyHint("app.orchestrator.toggleFinished", this.state.showFinished ? "hide" : "show")}`,
          width,
        ),
      );
    }
    // The round's own lines belong to its first task, so the window keeps the round title visible
    // when the cursor sits on the top row of a round.
    const cursorTop = shown[0]?.id === selected?.id ? 0 : undefined;
    let cursor: { start: number; end: number } | undefined;
    for (const task of shown) {
      const depth = depthOf(task, byId);
      const start = lines.length;
      lines.push(
        truncateToWidth(
          `${"  ".repeat(depth)}${this.rowLine(task, task.id === selected?.id, width - depth * 2)}`,
          width,
        ),
      );
      const reason = taskDetail.reasonLine(this.options.orchestrator, task);
      if (reason !== "") {
        lines.push(truncateToWidth(`${"  ".repeat(depth)}     ${theme.fg("dim", reason)}`, width));
      }
      if (task.id === selected?.id) cursor = { start: cursorTop ?? start, end: lines.length - 1 };
    }
    return { lines, cursor };
  }

  private renderList(width: number): ViewFrame {
    const tasks = this.tasks();
    const header = this.header("Tasks", viewHelpers.describeTaskCounts(tasks) ?? "", width);
    const replan = this.options.orchestrator.snapshot.replans[0];
    if (replan !== undefined) {
      header.push(truncateToWidth(` ${theme.fg("muted", describeReplan(replan))}`, width));
    }
    const borderIndex = header.length - 1 - (replan === undefined ? 0 : 1);
    if (tasks.length === 0) {
      return {
        header,
        borderIndex,
        body: [],
        footer: ["", ` ${keyHint("tui.select.cancel", "close")}`],
      };
    }
    const selected = this.selected();
    const body: string[] = [];
    let cursorLine: number | undefined;
    let cursorEnd: number | undefined;
    for (const round of this.options.orchestrator.snapshot.rounds) {
      const drawn = this.renderRound(round, selected, width);
      if (drawn.cursor !== undefined) {
        cursorLine = body.length + drawn.cursor.start;
        cursorEnd = body.length + drawn.cursor.end;
      }
      body.push(...drawn.lines);
    }
    if (this.composing !== undefined) {
      return {
        header,
        borderIndex,
        body,
        cursorLine,
        cursorEnd,
        footer: ["", ...this.renderComposer(width)],
      };
    }
    return {
      header,
      borderIndex,
      body,
      cursorLine,
      cursorEnd,
      footer: ["", taskDetail.listHints(this.state.showFinished, selected)],
    };
  }

  private renderDetail(task: TaskSnapshot, width: number): ViewFrame {
    const right = theme.fg(
      "dim",
      `${STATUS_LABEL[task.status].toLowerCase()} · ${task.round} · priority ${task.priority}`,
    );
    return {
      header: this.header(`${glyph(task)} ${task.title}`, right, width),
      body: taskDetail.sections(this.options.orchestrator, task, width),
      footer: [
        "",
        ...(this.composing === undefined ? [taskDetail.hints(task)] : this.renderComposer(width)),
      ],
    };
  }

  private renderComposer(width: number): string[] {
    const composing = this.composing;
    if (composing === undefined) return [];
    return [
      truncateToWidth(` ${theme.fg("accent", composerLabel(composing))}`, width),
      ...this.input.render(width),
      ` ${keyHint("tui.input.submit", composing.kind === "message" || composing.kind === "note" ? "send" : "set")}  ${keyHint("tui.select.cancel", "cancel")}`,
    ];
  }

  handleInput(data: string): void {
    if (this.composing !== undefined) {
      this.input.handleInput(data);
      this.options.requestRender();
      return;
    }
    const kb = getKeybindings();
    const shown = this.shownTasks();
    const selected = this.selected();
    const page = Math.max(1, this.room - 1);
    const half = Math.max(1, Math.floor(this.room / 2));
    if (kb.matches(data, "tui.select.cancel")) {
      if (this.openId === undefined) this.options.onClose();
      else this.openDetail(undefined);
    } else if (kb.matches(data, "app.orchestrator.back")) {
      this.options.onClose();
    } else if (this.openId !== undefined && kb.matches(data, "tui.select.up")) {
      this.scrollBy(-1);
    } else if (this.openId !== undefined && kb.matches(data, "tui.select.down")) {
      this.scrollBy(1);
    } else if (this.openId !== undefined && kb.matches(data, "tui.select.pageUp")) {
      this.scrollBy(-page);
    } else if (this.openId !== undefined && kb.matches(data, "tui.select.pageDown")) {
      this.scrollBy(page);
    } else if (this.openId !== undefined && matchesKey(data, "ctrl+u")) {
      this.scrollBy(-half);
    } else if (this.openId !== undefined && matchesKey(data, "ctrl+d")) {
      this.scrollBy(half);
    } else if (this.openId === undefined && kb.matches(data, "tui.select.up")) {
      this.move(shown, -1);
    } else if (this.openId === undefined && kb.matches(data, "tui.select.down")) {
      this.move(shown, 1);
    } else if (this.openId === undefined && kb.matches(data, "tui.select.pageUp")) {
      this.moveBy(shown, -page);
    } else if (this.openId === undefined && kb.matches(data, "tui.select.pageDown")) {
      this.moveBy(shown, page);
    } else if (this.openId === undefined && matchesKey(data, "ctrl+u")) {
      this.moveBy(shown, -half);
    } else if (this.openId === undefined && matchesKey(data, "ctrl+d")) {
      this.moveBy(shown, half);
    } else if (kb.matches(data, "app.orchestrator.toggleFinished")) {
      this.state.showFinished = !this.state.showFinished;
    } else if (kb.matches(data, "tui.select.confirm") && selected !== undefined) {
      this.openDetail(this.openId === undefined ? selected.id : undefined);
    } else if (kb.matches(data, "app.orchestrator.message") && selected !== undefined) {
      this.startComposing({ kind: "message", taskId: selected.id });
    } else if (kb.matches(data, "app.orchestrator.note") && selected !== undefined) {
      this.startComposing({ kind: "note", round: selected.round });
    } else if (kb.matches(data, "app.orchestrator.priority") && selected !== undefined) {
      this.startComposing({ kind: "priority", taskId: selected.id });
    } else if (kb.matches(data, "app.orchestrator.depends") && selected !== undefined) {
      this.startComposing({ kind: "depends", taskId: selected.id });
    } else if (kb.matches(data, "app.orchestrator.instruction") && selected !== undefined) {
      this.startComposing({ kind: "instruction", taskId: selected.id });
    } else if (
      kb.matches(data, "app.orchestrator.stop") &&
      selected !== undefined &&
      stoppable(selected)
    ) {
      this.options.orchestrator.stop(selected.id).catch((error: unknown) => {
        this.options.onError(toErrorMessage(error));
      });
    } else if (kb.matches(data, "app.orchestrator.rerun") && selected !== undefined) {
      this.options.orchestrator.rerun(selected.id).catch((error: unknown) => {
        this.options.onError(toErrorMessage(error));
      });
    } else if (kb.matches(data, "app.orchestrator.model") && selected !== undefined) {
      this.options.onPickModel(selected.id);
      return;
    }
    this.options.requestRender();
  }

  private move(tasks: readonly TaskSnapshot[], step: number): void {
    taskList.moveSelection(this.state, tasks, step);
  }

  private moveBy(tasks: readonly TaskSnapshot[], step: number): void {
    taskList.moveSelectionBy(this.state, tasks, step);
  }

  /** Moves the detail window; the next render clamps it to the content. */
  private scrollBy(lines: number): void {
    this.scroll = Math.max(0, this.scroll + lines);
  }

  private openDetail(id: string | undefined): void {
    this.openId = id;
    this.scroll = 0;
  }

  private startComposing(composing: Composing): void {
    this.composing = composing;
    this.input.setValue("");
    this.input.focused = this.isFocused;
  }

  private stopComposing(): void {
    this.composing = undefined;
    this.input.focused = false;
    this.options.requestRender();
  }

  private submit(value: string): void {
    const composing = this.composing;
    const text = value.trim();
    this.stopComposing();
    if (composing === undefined || text === "") return;
    const failed = (error: unknown) => {
      this.options.onError(toErrorMessage(error));
    };
    if (composing.kind === "priority") {
      this.options.orchestrator
        .setPriority(composing.taskId, Number.parseInt(text, 10))
        .catch(failed);
      return;
    }
    if (composing.kind === "note") {
      this.options.orchestrator
        .sendNote({ content: text, audience: "round", round: composing.round })
        .catch(failed);
      return;
    }
    if (composing.kind === "depends") {
      this.options.orchestrator
        .setDepends({ taskIds: [composing.taskId], ...parseDepends(text) })
        .catch(failed);
      return;
    }
    if (composing.kind === "instruction") {
      this.options.orchestrator.setInstruction(composing.taskId, text).catch(failed);
      return;
    }
    this.options.orchestrator.sendMessage(composing.taskId, text).catch(failed);
  }
}
