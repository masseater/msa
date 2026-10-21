import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import errors from "../../../utils/errors.ts";
import scrollWindow from "./scroll-window.ts";
import TaskComposer from "./task-composer.ts";
import tasksList from "./tasks-list.ts";
import tasksViewFrames from "./tasks-view-frames.ts";
import tasksViewHelpers from "./tasks-view-helpers.ts";
import type tasksViewHelpersTypes from "./tasks-view-helpers.types.ts";
import type tasksViewTypes from "./tasks-view.types.ts";

const { viewHelpers } = tasksViewHelpers;
const { taskList } = tasksList;
const { getKeybindings, matchesKey } = tui;
const { stoppable } = viewHelpers;

type Task = tasksViewTypes.TasksViewOptions["orchestrator"]["snapshot"]["tasks"][number];
type Keybindings = ReturnType<typeof getKeybindings>;

interface Step {
  matches: (kb: Keybindings, data: string) => boolean;
  lines: (page: number, half: number) => number;
  single: boolean;
}

const STEPS: Step[] = [
  { lines: () => -1, matches: (kb, d) => kb.matches(d, "tui.select.up"), single: true },
  { lines: () => 1, matches: (kb, d) => kb.matches(d, "tui.select.down"), single: true },
  { lines: (page) => -page, matches: (kb, d) => kb.matches(d, "tui.select.pageUp"), single: false },
  {
    lines: (page) => page,
    matches: (kb, d) => kb.matches(d, "tui.select.pageDown"),
    single: false,
  },
  { lines: (_page, half) => -half, matches: (_kb, d) => matchesKey(d, "ctrl+u"), single: false },
  { lines: (_page, half) => half, matches: (_kb, d) => matchesKey(d, "ctrl+d"), single: false },
];

export default class TasksView implements tuiTypes.Component, tuiTypes.Focusable {
  readonly wantsViewportKeys = true;
  private readonly options: tasksViewTypes.TasksViewOptions;
  private readonly state: tasksViewHelpersTypes.TasksViewState;
  private readonly composer: TaskComposer;
  private openId: string | undefined;
  private scroll = 0;
  private room = 0;
  private isFocused = false;

  constructor(options: tasksViewTypes.TasksViewOptions, initialId?: string) {
    this.options = options;
    this.state = options.state ?? viewHelpers.createTasksViewState();
    if (initialId !== undefined) this.state.selectedId = initialId;
    this.composer = new TaskComposer(options);
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.composer.setFocused(value);
  }

  invalidate(): void {}

  private selected(): Task | undefined {
    return taskList.selectedTask(this.options.orchestrator, this.state);
  }

  render(width: number): string[] {
    const open =
      this.openId === undefined
        ? undefined
        : this.options.orchestrator.snapshot.tasks.find((task) => task.id === this.openId);
    const context = {
      composer: this.composer,
      orchestrator: this.options.orchestrator,
      state: this.state,
      width,
    };
    const frame =
      open === undefined
        ? tasksViewFrames.listFrame(context, this.selected())
        : tasksViewFrames.detailFrame(context, open);
    const max = Math.max(8, this.options.maxHeight());
    const room = Math.max(0, max - frame.header.length - frame.footer.length);
    this.room = Math.min(room, frame.body.length);
    const fitted = scrollWindow.fitView(frame, width, max, this.scroll);
    this.scroll = fitted.offset;
    return fitted.lines;
  }

  handleInput(data: string): void {
    if (this.composer.active) {
      this.composer.handleInput(data);
      return;
    }
    const kb = getKeybindings();
    const selected = this.selected();
    if (kb.matches(data, "tui.select.cancel")) {
      if (this.openId === undefined) this.options.onClose();
      else this.openDetail(undefined);
    } else if (kb.matches(data, "app.orchestrator.back")) {
      this.options.onClose();
    } else if (!this.applyStep(kb, data) && !this.applyListAction(kb, data, selected)) {
      return;
    }
    this.options.requestRender();
  }

  private applyListAction(kb: Keybindings, data: string, selected: Task | undefined): boolean {
    if (kb.matches(data, "app.orchestrator.toggleFinished")) {
      this.state.showFinished = !this.state.showFinished;
      return true;
    }
    return selected === undefined || this.applyTaskAction(kb, data, selected);
  }

  private applyStep(kb: Keybindings, data: string): boolean {
    const step = STEPS.find((candidate) => candidate.matches(kb, data));
    if (step === undefined) return false;
    const page = Math.max(1, this.room - 1);
    const half = Math.max(1, Math.floor(this.room / 2));
    const lines = step.lines(page, half);
    if (this.openId !== undefined) {
      this.scroll = Math.max(0, this.scroll + lines);
      return true;
    }
    const shown = taskList.shownTasks(this.options.orchestrator, this.state);
    if (step.single) taskList.moveSelection(this.state, shown, lines);
    else taskList.moveSelectionBy(this.state, shown, lines);
    return true;
  }

  private applyTaskAction(kb: Keybindings, data: string, selected: Task): boolean {
    if (kb.matches(data, "tui.select.confirm")) {
      this.openDetail(this.openId === undefined ? selected.id : undefined);
    } else if (kb.matches(data, "app.orchestrator.message")) {
      this.composer.start({ kind: "message", taskId: selected.id });
    } else if (kb.matches(data, "app.orchestrator.note")) {
      this.composer.start({ kind: "note", round: selected.round });
    } else if (kb.matches(data, "app.orchestrator.depends")) {
      this.composer.start({ kind: "depends", taskId: selected.id });
    } else if (kb.matches(data, "app.orchestrator.currentState")) {
      this.composer.start(
        { field: "currentState", kind: "state", taskId: selected.id },
        selected.currentState,
      );
    } else if (kb.matches(data, "app.orchestrator.goalState")) {
      this.composer.start(
        { field: "goalState", kind: "state", taskId: selected.id },
        selected.goalState,
      );
    } else {
      return this.applyRunAction(kb, data, selected);
    }
    return true;
  }

  private applyRunAction(kb: Keybindings, data: string, selected: Task): boolean {
    const failed = (error: unknown) => this.options.onError(errors.toErrorMessage(error));
    if (kb.matches(data, "app.orchestrator.stop") && stoppable(selected)) {
      this.options.orchestrator.stop(selected.id).catch(failed);
    } else if (kb.matches(data, "app.orchestrator.rerun")) {
      this.options.orchestrator.rerun(selected.id).catch(failed);
    } else if (kb.matches(data, "app.orchestrator.model")) {
      this.options.onPickModel(selected.id);
      return false;
    }
    return true;
  }

  private openDetail(id: string | undefined): void {
    this.openId = id;
    this.scroll = 0;
  }
}
