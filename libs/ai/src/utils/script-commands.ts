import { Effect } from "effect";

import ScriptOutputError from "./script-output-error.ts";
import type scriptOutputTypes from "./script-output.types.ts";

const MSA_BINARY_NAMES: ReadonlySet<string> = new Set(["msa", "msa.exe"]);
const WINDOWS_SHELL_UNSAFE = /[\n\r!"%&()<>^|]/u;

const COMMANDS = {
  bun: { windowsShell: true },
  msa: { windowsShell: false },
  node: { windowsShell: false },
  npm: { windowsShell: true },
  pnpm: { windowsShell: false },
  sudo: { windowsShell: false },
  tar: { windowsShell: false },
  vp: { windowsShell: false },
  zip: { windowsShell: false },
} as const satisfies Record<scriptOutputTypes.CommandName, scriptOutputTypes.CommandRule>;

const resolveCommand = (
  basename: (path: string) => string,
  options: scriptOutputTypes.CommandOptions,
): Effect.Effect<{ readonly file: string; readonly shell: boolean }> => {
  if (typeof options.command !== "string") {
    const binary = options.command.msaBinary;
    return MSA_BINARY_NAMES.has(basename(binary))
      ? Effect.succeed({ file: binary, shell: false })
      : Effect.die(ScriptOutputError.make({ message: `${binary}: not an msa binary` }));
  }
  const name = options.command;
  const rule: scriptOutputTypes.CommandRule = COMMANDS[name];
  const shell = rule.windowsShell && process.platform === "win32";
  if (shell && options.args.some((arg) => WINDOWS_SHELL_UNSAFE.test(arg))) {
    return Effect.die(
      ScriptOutputError.make({
        message: `${name}: an argument holds a character cmd.exe would interpret`,
      }),
    );
  }
  return Effect.succeed({ file: name === "node" ? process.execPath : name, shell });
};

const scriptCommands = {
  resolveCommand,
};

export default scriptCommands;
