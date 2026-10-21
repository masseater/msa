import chalk from "chalk";

import type agentSessionRuntimeSupport from "../core/agent-session-runtime-support.ts";
import authGuidance from "../core/auth-guidance.ts";
import telemetrySupport from "../core/observability/telemetry-support.ts";
import platformModule from "../core/platform.ts";
import processEnv from "../core/process-env.ts";
import settingsDiagnostics from "../core/settings-diagnostics.ts";
import timings from "../core/timings.ts";
import cliInput from "./cli-input.ts";
import type startupModule from "./startup.ts";

const { formatNoModelsAvailableMessage } = authGuidance;
const { describeTelemetry } = telemetrySupport;
const { writeError } = platformModule;
const { readEnv } = processEnv;
const { deduplicateDiagnostics } = settingsDiagnostics;
const { time } = timings;
const { EXTENSION_LOAD_FAILURE_HINT, isTruthyEnvFlag, reportDiagnostics } = cliInput;

type Startup = Awaited<ReturnType<(typeof startupModule)["prepareStartup"]>>;
type Runtime = Awaited<
  ReturnType<(typeof agentSessionRuntimeSupport)["createAgentSessionRuntime"]>
>;

function startupDiagnostics(startup: Startup, runtime: Runtime) {
  const { telemetry } = startup;
  return deduplicateDiagnostics([
    ...startup.startupSettingsDiagnostics,
    ...runtime.diagnostics,
    ...(telemetry === undefined
      ? []
      : [{ message: describeTelemetry(telemetry.status()), type: "info" as const }]),
  ]);
}

function checkStartup(startup: Startup, runtime: Runtime) {
  time("resolveModelScope");
  const diagnostics = startupDiagnostics(startup, runtime);
  const interactive = startup.appMode === "interactive";
  const hasRuntimeErrors = runtime.diagnostics.some((diagnostic) => diagnostic.type === "error");
  if (!interactive || hasRuntimeErrors) reportDiagnostics(diagnostics);
  if (hasRuntimeErrors) {
    if (
      runtime.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Failed to load extension"),
      )
    ) {
      writeError(chalk.yellow(EXTENSION_LOAD_FAILURE_HINT));
    }
    process.exit(1);
  }
  time("createAgentSession");
  if (!interactive && runtime.session.model === undefined) {
    writeError(chalk.red(formatNoModelsAvailableMessage()));
    process.exit(1);
  }
  const startupBenchmark = isTruthyEnvFlag(readEnv("MSA_STARTUP_BENCHMARK"));
  if (startupBenchmark && !interactive) {
    writeError(chalk.red("Error: MSA_STARTUP_BENCHMARK only supports interactive mode"));
    process.exit(1);
  }
  return { startupBenchmark, startupDiagnostics: diagnostics };
}

const startupChecks = { checkStartup };

export default startupChecks;
