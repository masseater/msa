import type agentSessionRuntimeSupport from "../core/agent-session-runtime-support.ts";
import type bootstrapModule from "./bootstrap.ts";
import type sessionInput from "./session-input.ts";
import type startupChecks from "./startup-checks.ts";
import type startupModule from "./startup.ts";

declare namespace mainInternalTypes {
  type Boot = NonNullable<Awaited<ReturnType<(typeof bootstrapModule)["bootstrap"]>>>;

  type Startup = Awaited<ReturnType<(typeof startupModule)["prepareStartup"]>>;

  type Runtime = Awaited<
    ReturnType<(typeof agentSessionRuntimeSupport)["createAgentSessionRuntime"]>
  >;

  type Input = Awaited<ReturnType<(typeof sessionInput)["prepareInput"]>>;

  type Checks = ReturnType<(typeof startupChecks)["checkStartup"]>;
}

export type { mainInternalTypes as default };
