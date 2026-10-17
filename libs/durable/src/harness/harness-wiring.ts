import type { Context } from "@msa/chord";

import { resolveSettings } from "./agent.ts";
import { safeNow, safeReport } from "./harness-bound.ts";
import { createTaskScheduler, type SchedulerHost } from "./harness-scheduler-wiring.ts";
import type { TaskScheduler } from "./scheduler.ts";
import { Submissions } from "./submissions.ts";
import { TaskGraphView } from "./task-graph.ts";
import type { HarnessOptions, Storage, ToolRegistration } from "./types.ts";
import { ConversationViews } from "./view.ts";

export type HarnessClock = {
  readonly report: (error: unknown) => void;
  readonly now: () => number;
};

export type Wired = HarnessClock & {
  readonly tasks: TaskScheduler;
  readonly submissions: Submissions;
  readonly taskGraph: TaskGraphView;
  readonly views: ConversationViews;
};

export const harnessClock = <Tool extends ToolRegistration>(
  options: HarnessOptions<Tool>,
): HarnessClock => {
  const report = safeReport(options.onReport);
  return { report, now: safeNow(options.now, report) };
};

export type HarnessParts<Tool extends ToolRegistration> = {
  readonly host: SchedulerHost<Tool>;
  readonly storage: Storage;
  readonly options: HarnessOptions<Tool>;
  readonly clock: HarnessClock;
  readonly context: Context;
};

export const wireHarness = <Tool extends ToolRegistration>(parts: HarnessParts<Tool>): Wired => {
  const { host, storage, options, clock, context } = parts;
  const settings = () => resolveSettings(options.settings);
  let submissions: Submissions | undefined;
  const tasks = createTaskScheduler({
    host,
    storage,
    options,
    settings,
    now: clock.now,
    report: clock.report,
    submissions: () => submissions!,
    context,
  });
  submissions = new Submissions(host, storage, clock.now, settings, () => tasks.resume());
  return {
    ...clock,
    tasks,
    submissions,
    taskGraph: new TaskGraphView(host, storage),
    views: new ConversationViews(host, storage),
  };
};
