import tui from "@msa/tui";

import type orchestratorTypes from "../../../core/orchestrator/orchestrator.types.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import keybindingHints from "./keybinding-hints.ts";
import type scrollWindowTypes from "./scroll-window.types.ts";
import tasksRoundRender from "./tasks-round-render.ts";
import tasksViewDetail from "./tasks-view-detail.ts";
import tasksViewHelpers from "./tasks-view-helpers.ts";
import type tasksViewHelpersTypes from "./tasks-view-helpers.types.ts";

const { theme } = themeModule;
const { taskDetail } = tasksViewDetail;
const { viewHelpers } = tasksViewHelpers;
const { Spacer, truncateToWidth, visibleWidth } = tui;

type Task = orchestratorTypes.Orchestrator["snapshot"]["tasks"][number];

interface FrameContext {
  orchestrator: orchestratorTypes.Orchestrator;
  state: tasksViewHelpersTypes.TasksViewState;
  composer: { active: boolean; render: (width: number) => string[] };
  width: number;
}

function header(title: string, right: string, width: number): string[] {
  const gap = Math.max(1, width - 2 - visibleWidth(title) - visibleWidth(right));
  return [
    ...new Spacer(1).render(width),
    truncateToWidth(` ${theme.bold(title)}${" ".repeat(gap)}${right}`, width),
    ...new DynamicBorder((line) => theme.fg("borderMuted", line)).render(width),
  ];
}

function listFrame(context: FrameContext, selected: Task | undefined): scrollWindowTypes.ViewFrame {
  const { orchestrator, width } = context;
  const { snapshot } = orchestrator;
  const lines = header("Tasks", viewHelpers.describeTaskCounts(snapshot.tasks) ?? "", width);
  const replan = snapshot.replans[0];
  if (replan !== undefined) {
    const description = viewHelpers.describeReplan(replan);
    lines.push(truncateToWidth(` ${theme.fg("muted", description)}`, width));
  }
  const borderIndex = lines.length - 1 - (replan === undefined ? 0 : 1);
  if (snapshot.tasks.length === 0) {
    const footer = ["", ` ${keybindingHints.keyHint("tui.select.cancel", "close")}`];
    return { body: [], borderIndex, footer, header: lines };
  }
  const rounds = tasksRoundRender.renderRounds({
    orchestrator,
    selected,
    state: context.state,
    width,
  });
  const footer = context.composer.active
    ? ["", ...context.composer.render(width)]
    : ["", taskDetail.listHints(context.state.showFinished, selected)];
  return { ...rounds, borderIndex, footer, header: lines };
}

function detailFrame(context: FrameContext, task: Task): scrollWindowTypes.ViewFrame {
  const { width } = context;
  const status = viewHelpers.STATUS_LABEL[task.status].toLowerCase();
  const right = theme.fg("dim", `${status} · ${task.round}`);
  const hints = context.composer.active ? context.composer.render(width) : [taskDetail.hints(task)];
  return {
    body: taskDetail.sections(context.orchestrator, task, width),
    footer: ["", ...hints],
    header: header(`${viewHelpers.glyph(task)} ${task.title}`, right, width),
  };
}

const tasksViewFrames = {
  detailFrame,
  listFrame,
};

export default tasksViewFrames;
