import type { Context } from "@msa/chord";

import type harnessBound from "./harness-bound.ts";
import type schedulerTypes from "./scheduler.types.ts";
import type typesModule from "./types.types.ts";

declare namespace harnessSchedulerWiringTypes {
  type SchedulerHost<Tool extends typesModule.ToolRegistration> =
    schedulerTypes.TaskSchedulerOptions["session"] & {
      resolveAgent(
        id: typesModule.ConversationId,
        snapshot: typesModule.RegistrySnapshot<Tool> | undefined,
        context: Context,
      ): Promise<typesModule.Agent<Tool>>;
      buildEnv: schedulerTypes.TaskSchedulerOptions["env"];
    };

  type SchedulerWiring<Tool extends typesModule.ToolRegistration> = {
    readonly host: SchedulerHost<Tool>;
    readonly storage: typesModule.Storage;
    readonly options: typesModule.HarnessOptions<Tool>;
    readonly settings: () => typesModule.Settings;
    readonly now: () => number;
    readonly report: (error: unknown) => void;
    readonly submissions: () => Parameters<typeof harnessBound.boundConversation>[2];
    readonly context: Context;
  };
}

export type { harnessSchedulerWiringTypes as default };
