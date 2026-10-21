import agentModule from "./agent.ts";
import harnessBound from "./harness-bound.ts";
import harnessSchedulerWiring from "./harness-scheduler-wiring.ts";
import type harnessWiringTypes from "./harness-wiring.types.ts";
import Submissions from "./submissions.ts";
import type submissionsTypes from "./submissions.types.ts";
import TaskGraphView from "./task-graph.ts";
import type typesModule from "./types.types.ts";
import view from "./view.ts";

const { safeNow, safeReport } = harnessBound;
const { resolveSettings } = agentModule;
const { createTaskScheduler } = harnessSchedulerWiring;

const { ConversationViews } = view;

const harnessClock = <Tool extends typesModule.ToolRegistration>(
  options: typesModule.HarnessOptions<Tool>,
): harnessWiringTypes.HarnessClock => {
  const report = safeReport(options.onReport);
  return { now: safeNow(options.now, report), report };
};

const wireHarness = <Tool extends typesModule.ToolRegistration>(
  parts: harnessWiringTypes.HarnessParts<Tool>,
): harnessWiringTypes.Wired => {
  const { host, storage, options, clock, context } = parts;
  const settings = () => resolveSettings(options.settings);
  let submissions: submissionsTypes.Submissions | undefined;
  const tasks = createTaskScheduler({
    context,
    host,
    now: clock.now,
    options,
    report: clock.report,
    settings,
    storage,
    submissions: () => submissions!,
  });
  submissions = new Submissions(host, storage, clock.now, settings, () => tasks.resume());
  return {
    ...clock,
    submissions,
    taskGraph: new TaskGraphView(host, storage),
    tasks,
    views: new ConversationViews(host, storage),
  };
};

const harnessWiring = {
  harnessClock,
  wireHarness,
};

export default harnessWiring;
