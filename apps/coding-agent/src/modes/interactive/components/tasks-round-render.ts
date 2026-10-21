import tui from "@msa/tui";

import type orchestratorTypes from "../../../core/orchestrator/orchestrator.types.ts";
import type orchestratorTypesTypes from "../../../core/orchestrator/types.types.ts";
import textModule from "../../../utils/text.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import tasksList from "./tasks-list.ts";
import tasksViewDetail from "./tasks-view-detail.ts";
import tasksViewHelpers from "./tasks-view-helpers.ts";
import type tasksViewHelpersTypes from "./tasks-view-helpers.types.ts";

const { theme } = themeModule;
const { truncateToWidth } = tui;
const { viewHelpers } = tasksViewHelpers;
const { depthOf, finished, glyph, modelName, roundTasks } = viewHelpers;

type Task = orchestratorTypesTypes.TaskSnapshot;

interface RoundContext {
  orchestrator: orchestratorTypes.Orchestrator;
  state: tasksViewHelpersTypes.TasksViewState;
  selected: Task | undefined;
  width: number;
}

interface DrawnRound {
  lines: string[];
  cursor?: { start: number; end: number } | undefined;
}

function roundTitle(inRound: Task[], title: string): string {
  const review = inRound.find((task) => task.kind === "review");
  const reviewSuffix = review === undefined ? "" : `  ${glyph(review)} review ${review.status}`;
  return theme.fg("muted", ` ${title}${reviewSuffix}`);
}

function finishedSummary(inRound: Task[], context: RoundContext): string | undefined {
  const done = inRound.filter((task) => task.status === "completed").length;
  const stopped = inRound.filter((task) => task.status === "stopped").length;
  if (done + stopped === 0) return undefined;
  const counts = [
    done > 0 ? `${theme.fg("success", "✓")} ${done} done` : undefined,
    stopped > 0 ? `${theme.fg("dim", "■")} ${stopped} stopped` : undefined,
  ]
    .filter(Boolean)
    .join("  ");
  const toggle = keybindingHints.keyHint(
    "app.orchestrator.toggleFinished",
    context.state.showFinished ? "hide" : "show",
  );
  return truncateToWidth(`   ${counts}  ${toggle}`, context.width);
}

function taskRowLine(task: Task, context: RoundContext, depth: number): string {
  const row = tasksList.taskList.taskRow(task, {
    meta: (entry) =>
      [textModule.shortId(entry.id), modelName(entry.model ?? "default")]
        .filter(Boolean)
        .join("  "),
    selected: task.id === context.selected?.id,
    width: context.width - depth * 2,
  });
  return truncateToWidth(`${"  ".repeat(depth)}${row}`, context.width);
}

function renderRound(round: { id: string; title: string }, context: RoundContext): DrawnRound {
  const inRound = roundTasks(context.orchestrator.snapshot.tasks, round.id);
  if (inRound.length === 0) return { lines: [] };
  const lines = [roundTitle(inRound, round.title)];
  const summary = finishedSummary(inRound, context);
  if (summary !== undefined) lines.push(summary);
  const byId = new Map(inRound.map((task) => [task.id, task]));
  const shown = inRound.filter((task) => context.state.showFinished || !finished(task));
  const cursorTop = shown[0]?.id === context.selected?.id ? 0 : undefined;
  let cursor: DrawnRound["cursor"];
  for (const task of shown) {
    const depth = depthOf(task, byId);
    const start = lines.length;
    lines.push(taskRowLine(task, context, depth));
    const reason = tasksViewDetail.taskDetail.reasonLine(context.orchestrator, task);
    if (reason !== "") {
      lines.push(
        truncateToWidth(`${"  ".repeat(depth)}     ${theme.fg("dim", reason)}`, context.width),
      );
    }
    if (task.id === context.selected?.id) {
      cursor = { end: lines.length - 1, start: cursorTop ?? start };
    }
  }
  return { cursor, lines };
}

function renderRounds(context: RoundContext): {
  body: string[];
  cursorLine?: number | undefined;
  cursorEnd?: number | undefined;
} {
  const body: string[] = [];
  let cursorLine: number | undefined;
  let cursorEnd: number | undefined;
  for (const round of context.orchestrator.snapshot.rounds) {
    const drawn = renderRound(round, context);
    if (drawn.cursor !== undefined) {
      cursorLine = body.length + drawn.cursor.start;
      cursorEnd = body.length + drawn.cursor.end;
    }
    body.push(...drawn.lines);
  }
  return { body, cursorEnd, cursorLine };
}

const tasksRoundRender = {
  renderRounds,
};

export default tasksRoundRender;
