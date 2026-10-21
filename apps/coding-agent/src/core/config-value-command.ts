import shellModule from "../utils/shell.ts";
import nodeChildProcess from "./platform/node/child-process.ts";

const { execSync, spawnSync } = nodeChildProcess;

const commandResultCache = new Map<string, string | undefined>();

function executeWithConfiguredShell(command: string): {
  executed: boolean;
  value: string | undefined;
} {
  try {
    const { shell, args, commandTransport } = shellModule.getShellConfig();
    const commandFromStdin = commandTransport === "stdin";
    const result = spawnSync(shell, commandFromStdin ? args : [...args, command], {
      encoding: "utf-8",
      input: commandFromStdin ? command : undefined,
      shell: false,
      stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "ignore"],
      timeout: 10000,
      windowsHide: true,
    });

    if (result.error !== undefined) {
      const error = result.error as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return { executed: false, value: undefined };
      }
      return { executed: true, value: undefined };
    }

    if (result.status !== 0) {
      return { executed: true, value: undefined };
    }

    const value = (result.stdout ?? "").trim();
    return { executed: true, value: value || undefined };
  } catch {
    return { executed: false, value: undefined };
  }
}

function executeWithDefaultShell(command: string): string | undefined {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

function executeCommandUncached(commandConfig: string): string | undefined {
  const command = commandConfig.slice(1);
  return process.platform === "win32"
    ? (() => {
        const configuredResult = executeWithConfiguredShell(command);
        return configuredResult.executed
          ? configuredResult.value
          : executeWithDefaultShell(command);
      })()
    : executeWithDefaultShell(command);
}

function executeCommand(commandConfig: string): string | undefined {
  if (commandResultCache.has(commandConfig)) {
    return commandResultCache.get(commandConfig);
  }

  const result = executeCommandUncached(commandConfig);
  commandResultCache.set(commandConfig, result);
  return result;
}

const configValueCommand = { commandResultCache, executeCommand, executeCommandUncached };

export default configValueCommand;
