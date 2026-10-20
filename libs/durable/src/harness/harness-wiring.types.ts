import type chordTypes from "@msa/chord/index.types";

import type harnessSchedulerWiringTypes from "./harness-scheduler-wiring.types.ts";
import type schedulerTypes from "./scheduler.types.ts";
import type submissionsTypes from "./submissions.types.ts";
import type taskGraphTypes from "./task-graph.types.ts";
import type typesModule from "./types.types.ts";
import type viewTypes from "./view.types.ts";

declare namespace harnessWiringTypes {
  type HarnessClock = {
    readonly report: (error: unknown) => void;
    readonly now: () => number;
  };

  type Wired = HarnessClock & {
    readonly tasks: schedulerTypes.TaskScheduler;
    readonly submissions: submissionsTypes.Submissions;
    readonly taskGraph: taskGraphTypes.TaskGraphView;
    readonly views: viewTypes.ConversationViews;
  };

  type HarnessParts<Tool extends typesModule.ToolRegistration> = {
    readonly host: harnessSchedulerWiringTypes.SchedulerHost<Tool>;
    readonly storage: typesModule.Storage;
    readonly options: typesModule.HarnessOptions<Tool>;
    readonly clock: HarnessClock;
    readonly context: chordTypes.Context;
  };
}

export type { harnessWiringTypes as default };
