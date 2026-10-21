import type argsTypes from "./args.types.ts";
import flagHandlers from "./args/flag-handlers.ts";
import help from "./args/help.ts";

const { FLAG_HANDLERS } = flagHandlers;
const { printHelp } = help;

function normalizeSessionName(value: string): string | undefined {
  const name = value.trim();
  return name.length > 0 ? name : undefined;
}

function addPositional(result: argsTypes.Args, arg: string): void {
  if (arg.startsWith("@")) result.fileArgs.push(arg.slice(1));
  else result.messages.push(arg);
}

function addUnknownFlag(result: argsTypes.Args, arg: string, next: string | undefined): number {
  const eqIndex = arg.indexOf("=");
  if (eqIndex !== -1) {
    result.unknownFlags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
    return 0;
  }
  if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
    result.unknownFlags.set(arg.slice(2), next);
    return 1;
  }
  result.unknownFlags.set(arg.slice(2), true);
  return 0;
}

function applyArg(result: argsTypes.Args, arg: string, next: string | undefined): number {
  const consumed = FLAG_HANDLERS.get(arg)?.(result, next, arg);
  if (consumed !== undefined) return consumed;
  if (arg.startsWith("--")) return addUnknownFlag(result, arg, next);
  if (arg.startsWith("-")) {
    result.diagnostics.push({ message: `Unknown option: ${arg}`, type: "error" });
    return 0;
  }
  addPositional(result, arg);
  return 0;
}

function parseArgs(args: string[]): argsTypes.Args {
  const result: argsTypes.Args = {
    diagnostics: [],
    fileArgs: [],
    messages: [],
    unknownFlags: new Map(),
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--") {
      for (const positional of args.slice(i + 1)) addPositional(result, positional);
      break;
    }
    i += applyArg(result, arg, args[i + 1]);
  }
  return result;
}

const argsModule = {
  normalizeSessionName,
  parseArgs,
  printHelp,
};

export default argsModule;
