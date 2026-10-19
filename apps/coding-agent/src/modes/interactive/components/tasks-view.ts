import {
  type Component,
  type Focusable,
  getKeybindings,
  Input,
  Spacer,
  truncateToWidth,
  visibleWidth,
} from "@msa/tui";

import type { Orchestrator } from "../../../core/orchestrator/orchestrator.ts";
import type { TaskSnapshot } from "../../../core/orchestrator/types.ts";
import { toErrorMessage } from "../../../utils/errors.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";
import { taskDetail } from "./tasks-view-detail.ts";
import { type TasksViewState, viewHelpers } from "./tasks-view-helpers.ts";

const { STATUS_LABEL, glyph, finished, stoppable, modelName, depthOf, roundTasks } = viewHelpers;
const { describeReplan } = viewHelpers;

type Composing =
  | { kind: "message"; taskId: string }
  | { kind: "note"; round: string }
  | { kind: "priority"; taskId: string };

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
  private readonly options: TasksViewOptions;
  private selectedId: string | undefined;
  private openId: string | undefined;
  private readonly input = new Input({ prompt: "› " });
  private readonly state: TasksViewState;
  private composing: Composing | undefined;
  private isFocused = false;

  constructor(options: TasksViewOptions, initialId?: string) {
    this.options = options;
    this.state = options.state ?? viewHelpers.createTasksViewState();
    this.selectedId = initialId;
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

  private visibleTasks(tasks: readonly TaskSnapshot[]): TaskSnapshot[] {
    return tasks.filter((task) => this.state.showFinished || !finished(task));
  }

  private selected(): TaskSnapshot | undefined {
    const visible = this.visibleTasks(this.tasks());
    const current = visible.find((task) => task.id === this.selectedId);
    return current ?? visible[0];
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
    const cursor = selected ? theme.fg("accent", "›") : " ";
    const title = selected ? theme.bold(task.title) : task.title;
    const mark = task.replan === null ? "" : ` ${theme.fg("muted", "↺")}`;
    const meta = theme.fg("dim", modelName(task.model ?? "default"));
    const left = ` ${cursor} ${glyph(task)} ${title}${mark}`;
    const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(meta) - 1);
    return truncateToWidth(`${left}${" ".repeat(gap)}${meta}`, width);
  }

  render(width: number): string[] {
    const open =
      this.openId === undefined ? undefined : this.tasks().find((task) => task.id === this.openId);
    const lines = open === undefined ? this.renderList(width) : this.renderDetail(open, width);
    const max = Math.max(8, this.options.maxHeight());
    const hints = lines.pop() ?? "";
    return [...lines.slice(0, max - 1), hints];
  }

  private renderRound(
    round: { id: string; title: string },
    selected: TaskSnapshot | undefined,
    width: number,
  ): string[] {
    const tasks = this.tasks();
    const inRound = roundTasks(tasks, round.id);
    if (inRound.length === 0) return [];
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
    for (const task of shown) {
      const depth = depthOf(task, byId);
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
    }
    return lines;
  }

  private renderList(width: number): string[] {
    const tasks = this.tasks();
    const lines = this.header("Tasks", viewHelpers.describeTaskCounts(tasks) ?? "", width);
    const replan = this.options.orchestrator.snapshot.replans[0];
    if (replan !== undefined) {
      lines.push(truncateToWidth(` ${theme.fg("muted", describeReplan(replan))}`, width));
    }
    if (tasks.length === 0) {
      lines.push("", ` ${keyHint("tui.select.cancel", "close")}`);
      return lines;
    }
    const selected = this.selected();
    for (const round of this.options.orchestrator.snapshot.rounds) {
      lines.push(...this.renderRound(round, selected, width));
    }
    lines.push("");
    if (this.composing === undefined) {
      lines.push(taskDetail.listHints(this.state.showFinished, selected));
      return lines;
    }
    lines.push(...this.renderComposer(width));
    return lines;
  }

  private renderDetail(task: TaskSnapshot, width: number): string[] {
    const right = theme.fg(
      "dim",
      `${STATUS_LABEL[task.status].toLowerCase()} · ${task.round} · priority ${task.priority}`,
    );
    const lines = [
      ...this.header(`${glyph(task)} ${task.title}`, right, width),
      ...taskDetail.sections(this.options.orchestrator, task, width),
    ];
    lines.push("");
    if (this.composing === undefined) lines.push(taskDetail.hints(task));
    else lines.push(...this.renderComposer(width));
    return lines;
  }

  private renderComposer(width: number): string[] {
    const composing = this.composing;
    if (composing === undefined) return [];
    const label =
      composing.kind === "message"
        ? "Message to this task"
        : composing.kind === "note"
          ? `Shared note to round ${composing.round}`
          : "New priority";
    return [
      truncateToWidth(` ${theme.fg("accent", label)}`, width),
      ...this.input.render(width),
      ` ${keyHint("tui.input.submit", composing.kind === "priority" ? "set" : "send")}  ${keyHint("tui.select.cancel", "cancel")}`,
    ];
  }

  handleInput(data: string): void {
    if (this.composing !== undefined) {
      this.input.handleInput(data);
      this.options.requestRender();
      return;
    }
    const kb = getKeybindings();
    const visible = this.visibleTasks(this.tasks());
    const selected = this.selected();
    if (kb.matches(data, "tui.select.cancel")) {
      if (this.openId === undefined) this.options.onClose();
      else this.openId = undefined;
    } else if (this.openId === undefined && kb.matches(data, "tui.select.up")) {
      this.move(visible, -1);
    } else if (this.openId === undefined && kb.matches(data, "tui.select.down")) {
      this.move(visible, 1);
    } else if (kb.matches(data, "app.orchestrator.toggleFinished")) {
      this.state.showFinished = !this.state.showFinished;
    } else if (kb.matches(data, "tui.select.confirm") && selected !== undefined) {
      this.openId = this.openId === undefined ? selected.id : undefined;
    } else if (kb.matches(data, "app.orchestrator.message") && selected !== undefined) {
      this.startComposing({ kind: "message", taskId: selected.id });
    } else if (kb.matches(data, "app.orchestrator.note") && selected !== undefined) {
      this.startComposing({ kind: "note", round: selected.round });
    } else if (kb.matches(data, "app.orchestrator.priority") && selected !== undefined) {
      this.startComposing({ kind: "priority", taskId: selected.id });
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
    if (tasks.length === 0) return;
    const index = tasks.findIndex((task) => task.id === this.selected()?.id);
    this.selectedId = tasks[(index + step + tasks.length) % tasks.length]?.id;
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
    this.options.orchestrator.sendMessage(composing.taskId, text).catch(failed);
  }
}
