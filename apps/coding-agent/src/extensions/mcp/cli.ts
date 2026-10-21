import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../../core/awaiting.ts";
import platform from "../../core/platform/index.ts";
import type cliTypes from "./cli.types.ts";
import cliOptions from "./cli/cli-options.ts";
import commandContext from "./cli/command-context.ts";
import serverCommands from "./cli/server-commands.ts";
import serverConfig from "./cli/server-config.ts";

const { awaited, awaiting } = awaitingModule;
const { writeError, writeLog } = platform;
const { HELP, HELP_HINT } = cliOptions;
const { add, projectConfigPath, remove } = serverConfig;
const { loadCommandContext } = commandContext;
const { listCommand, loginOrLogout } = serverCommands;

function runMcpCommandImpl(args: string[], options: cliTypes.McpCommandOptions): Promise<number> {
  return Effect.runPromise(
    awaiting(function* () {
      const log = options.log ?? ((line: string) => writeLog(line));
      const error = options.error ?? ((line: string) => writeError(line));
      const [command, ...rest] = args;
      if (
        command === undefined ||
        command === "help" ||
        args.includes("--help") ||
        args.includes("-h")
      ) {
        log(HELP);
        return 0;
      }
      const projectConfig = projectConfigPath(options);
      if (command === "add") return add(rest, projectConfig, options, log, error);
      if (command === "remove") return remove(rest, projectConfig, options, log, error);
      const context = yield* awaited(loadCommandContext(options, projectConfig, log, error));
      if (command === "list") return yield* awaited(listCommand(rest, context));
      if (command === "login" || command === "logout") {
        return yield* awaited(loginOrLogout(command, rest, context));
      }
      error(`Unknown mcp command "${command}".\n${HELP_HINT}`);
      return 1;
    }),
  );
}

const runMcpCommand: {
  (args: string[], options: cliTypes.McpCommandOptions): Promise<number>;
  (options: cliTypes.McpCommandOptions): (args: string[]) => Promise<number>;
} = dual((args: IArguments) => args.length >= 2, runMcpCommandImpl);

const cli = { runMcpCommand };

export default cli;
