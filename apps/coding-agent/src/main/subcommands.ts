import { Effect } from "effect";

import awaitingModule from "../core/awaiting.ts";
import type extensionsTypesTypes from "../core/extensions/types.types.ts";
import memoryCliLazy from "../core/memory/memory-cli.lazy.ts";
import cliLazy from "../extensions/mcp/cli.lazy.ts";
import packageManagerCli from "../package-manager-cli.ts";

const { awaited, awaiting } = awaitingModule;
const { loadMcpCommand } = cliLazy;
const { loadMemoryCli } = memoryCliLazy;
const { handleConfigCommand, handlePackageCommand } = packageManagerCli;

type Context = {
  agentDir: string;
  cwd: string;
  extensionFactories: extensionsTypesTypes.InlineExtension[];
};

function runSubcommand(args: string[], context: Context): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      const { agentDir, cwd, extensionFactories } = context;
      if (yield* awaited(handlePackageCommand(args, { extensionFactories }))) {
        const exitCode = process.exitCode ?? 0;
        if (process.platform === "win32" && exitCode === 0 && args[0] === "update") return true;
        return process.exit(exitCode);
      }
      if (yield* awaited(handleConfigCommand(args, { extensionFactories }))) return true;
      if (args[0] === "mcp") {
        const { runMcpCommand } = yield* awaited(loadMcpCommand());
        process.exitCode = yield* awaited(runMcpCommand(args.slice(1), { agentDir, cwd }));
        return true;
      }
      if (args[0] === "memory") {
        const { runMemoryCli } = yield* awaited(loadMemoryCli());
        process.exitCode = yield* awaited(runMemoryCli(args.slice(1), { agentDir, cwd }));
        return true;
      }
      return false;
    }),
  );
}

const subcommands = { runSubcommand };

export default subcommands;
