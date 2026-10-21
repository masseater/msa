import * as Effect from "effect/Effect";

import configModule from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import type mcpServersTypes from "../../../core/mcp-servers.types.ts";
import ProjectTrustStore from "../../../core/project-trust-store.ts";
import errorsModule from "../../../utils/errors.ts";
import type cliTypes from "../cli.types.ts";
import mcpConfig from "../config.ts";

const { APP_NAME } = configModule;
const { toErrorMessage } = errorsModule;
const { addMcpServerConfig, loadMcpConfig, removeMcpServerConfig } = mcpConfig;
const { awaited, awaiting } = awaitingModule;

type Line = (line: string) => void;

interface Target {
  readonly name: string;
  readonly path: string;
  readonly options: cliTypes.McpCommandOptions;
  readonly log: Line;
  readonly error: Line;
}

function saveAddedServer(
  target: Target & {
    readonly validated: mcpServersTypes.McpServerConfig;
    readonly project: boolean;
  },
): Promise<boolean> {
  const { error, log, name, options, path, project, validated } = target;
  return Effect.runPromise(
    awaiting(function* () {
      let replaced: boolean;
      try {
        replaced = yield* awaited(addMcpServerConfig(path, name, validated));
      } catch (addError) {
        error(`Could not update ${path}: ${toErrorMessage(addError)}`);
        return false;
      }
      const scope = project ? "project" : "global";
      log(`${replaced ? "Replaced" : "Added"} ${scope} MCP server "${name}" in ${path}.`);
      const trusted = project
        ? (yield* awaited(new ProjectTrustStore(options.agentDir).get(options.cwd))) === true
        : true;
      if (!trusted)
        log(
          `The project is not trusted, so ${path} is ignored until you start ${APP_NAME} in the project and trust it.`,
        );
      return true;
    }),
  );
}

function removeConfiguredServer(target: Target & { readonly scope: string }): Promise<number> {
  const { error, log, name, options, path, scope } = target;
  return Effect.runPromise(
    awaiting(function* () {
      let removed: boolean;
      try {
        removed = yield* awaited(removeMcpServerConfig(path, name));
      } catch (removeError) {
        error(`Could not update ${path}: ${toErrorMessage(removeError)}`);
        return 1;
      }
      if (removed) {
        log(`Removed ${scope} MCP server "${name}" from ${path}.`);
        return 0;
      }
      const loaded = yield* awaited(
        loadMcpConfig({ agentDir: options.agentDir, cwd: options.cwd, projectTrusted: true }),
      );
      const other = loaded.servers.find((server) => server.name === name && server.scope !== scope);
      error(
        `No ${scope} MCP server named "${name}" in ${path}.${other === undefined ? "" : ` It is defined in ${other.source}${other.scope === "project" ? "; use --local" : "; omit --local"}.`}`,
      );
      return 1;
    }),
  );
}

const serverPersist = { removeConfiguredServer, saveAddedServer };

export default serverPersist;
