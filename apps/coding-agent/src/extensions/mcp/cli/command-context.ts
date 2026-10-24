import * as Effect from "effect/Effect";

import configModule from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import platform from "../../../core/platform/index.ts";
import ProjectTrustStore from "../../../core/project-trust-store.ts";
import type cliInternalTypes from "../cli-internal.types.ts";
import type cliTypes from "../cli.types.ts";
import mcpConfig from "../config.ts";
import runtime from "../runtime.ts";

const { APP_NAME } = configModule;
const { awaited, awaiting } = awaitingModule;
const { exists } = platform.files;
const { loadMcpConfig } = mcpConfig;
const { McpOAuthCredentialStore } = runtime;

function loadCommandContext(
  options: cliTypes.McpCommandOptions,
  projectConfig: string,
  log: (line: string) => void,
  error: (line: string) => void,
): Promise<cliInternalTypes.CommandContext> {
  return Effect.runPromise(
    awaiting(function* () {
      const projectTrusted =
        (yield* awaited(new ProjectTrustStore(options.agentDir).get(options.cwd))) === true;
      const loaded = yield* awaited(
        loadMcpConfig({
          agentDir: options.agentDir,
          builtins: options.builtins ?? [],
          cwd: options.cwd,
          projectTrusted,
        }),
      );
      const untrustedNote =
        !projectTrusted && (yield* awaited(exists(projectConfig)))
          ? `${projectConfig} is ignored because the project is not trusted. Start ${APP_NAME} in the project to trust it.`
          : undefined;
      const credentials = options.credentials ?? new McpOAuthCredentialStore();
      return { credentials, error, loaded, log, options, untrustedNote };
    }),
  );
}

const commandContext = { loadCommandContext };

export default commandContext;
