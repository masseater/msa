import chalk from "chalk";

import config from "../config.ts";
import type agentSessionServicesTypes from "../core/agent-session-services.types.ts";
import platformModule from "../core/platform.ts";

const { APP_NAME } = config;
const { writeError } = platformModule;

const EXTENSION_LOAD_FAILURE_HINT = `Hint: Start without extensions using "${APP_NAME} -ne".`;

function reportDiagnostics(
  diagnostics: readonly agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    const color =
      diagnostic.type === "error"
        ? chalk.red
        : diagnostic.type === "warning"
          ? chalk.yellow
          : chalk.dim;
    const prefix =
      diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
    writeError(color(`${prefix}${diagnostic.message}`));
  }
}

const diagnosticsModule = { EXTENSION_LOAD_FAILURE_HINT, reportDiagnostics };

export default diagnosticsModule;
