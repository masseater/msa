import settingsManagerSupport from "../core/settings-manager-support.ts";
import thinkingLevels from "../core/thinking-levels.ts";
import type argsTypes from "./args.types.ts";

const { getToolListError } = settingsManagerSupport;
const { VALID_THINKING_LEVELS, isValidThinkingLevel } = thinkingLevels;

function normalizeSessionName(value: string): string | undefined {
  const name = value.trim();
  return name.length > 0 ? name : undefined;
}

function parseArgsPart13(i: number, result: argsTypes.Args, nextArg: string) {
  i++;
  result.excludeTools = nextArg
    .split(",")
    .map((s) => s.trim())
    .filter((name) => name.length > 0);
  return i;
}

function parseArgsPart12(result: argsTypes.Args) {
  result.diagnostics.push({
    message:
      "--orchestrator is the default: the orchestrator tools are always enabled. Remove the flag.",
    type: "error",
  });
}

function parseArgsPart11(i: number, result: argsTypes.Args, nextArg: string) {
  i++;
  result.models = nextArg
    .split(",")
    .map((s) => s.trim())
    .filter((pattern) => pattern.length > 0);
  return i;
}

function parseArgsPart10(nextArg: string | undefined, result: argsTypes.Args, i: number) {
  if (nextArg !== undefined && !nextArg.startsWith("-") && !nextArg.startsWith("@")) {
    result.listModels = nextArg;
    i++;
  } else {
    result.listModels = true;
  }
  return i;
}

function parseArgsPart9(nextArg: string | undefined, result: argsTypes.Args, i: number) {
  if (nextArg === undefined) {
    result.diagnostics.push({ message: "--name requires a value", type: "error" });
  } else {
    result.name = nextArg;
    i++;
  }
  return i;
}

function parseArgsPart8(): argsTypes.Args {
  return {
    diagnostics: [],
    fileArgs: [],
    messages: [],
    unknownFlags: new Map(),
  };
}

function parseArgsPart7(nextArg: string | undefined, result: argsTypes.Args, i: number) {
  const themeName = nextArg;
  if (themeName === undefined || themeName.startsWith("-")) {
    result.diagnostics.push({ message: "--use-theme requires a theme name", type: "error" });
  } else {
    result.useTheme = themeName;
    i++;
  }
  return i;
}

function parseArgsPart6(args: string[], i: number, result: argsTypes.Args) {
  for (const positionalArg of args.slice(i + 1)) {
    if (positionalArg.startsWith("@")) {
      result.fileArgs.push(positionalArg.slice(1));
    } else {
      result.messages.push(positionalArg);
    }
  }
}

function parseArgsPart5(result: argsTypes.Args, nextArg: string | undefined, i: number) {
  result.print = true;
  const next = nextArg;
  if (
    next !== undefined &&
    !next.startsWith("@") &&
    (!next.startsWith("-") || next.startsWith("---"))
  ) {
    result.messages.push(next);
    i++;
  }
  return i;
}

function parseArgsPart4(i: number, nextArg: string, result: argsTypes.Args) {
  i++;
  const level = nextArg;
  if (isValidThinkingLevel(level)) {
    result.thinking = level;
  } else {
    result.diagnostics.push({
      message: `Invalid thinking level "${level}". Valid values: ${VALID_THINKING_LEVELS.join(", ")}`,
      type: "warning",
    });
  }
  return i;
}

function parseArgsPart3(i: number, nextArg: string, result: argsTypes.Args, arg: string) {
  i++;
  const tools = nextArg
    .split(",")
    .map((s) => s.trim())
    .filter((name) => name.length > 0);
  const error = getToolListError(tools);
  if (error !== undefined && error !== "") {
    result.diagnostics.push({ message: `${arg}: ${error}`, type: "error" });
  } else {
    result.tools = tools;
  }
  return i;
}

function parseArgsPart2(
  arg: string,
  nextArg: string | undefined,
  result: argsTypes.Args,
  i: number,
) {
  const eqIndex = arg.indexOf("=");
  if (eqIndex === -1) {
    const flagName = arg.slice(2);
    const next = nextArg;
    if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
      result.unknownFlags.set(flagName, next);
      i++;
    } else {
      result.unknownFlags.set(flagName, true);
    }
  } else {
    result.unknownFlags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
  }
  return i;
}

function parseArgsPart1(nextArg: string | undefined, result: argsTypes.Args, i: number) {
  const mode = nextArg;
  if (mode === "regular" || mode === "fullscreen") {
    result.tuiMode = mode;
    i++;
  } else if (mode === undefined || mode.startsWith("-")) {
    result.diagnostics.push({
      message: "--tui-mode requires regular or fullscreen",
      type: "error",
    });
  } else {
    i++;
    result.diagnostics.push({
      message: `Invalid TUI mode "${mode}". Valid values: regular, fullscreen`,
      type: "error",
    });
  }
  return i;
}

const argsPart1 = {
  normalizeSessionName,
  parseArgsPart1,
  parseArgsPart10,
  parseArgsPart11,
  parseArgsPart12,
  parseArgsPart13,
  parseArgsPart2,
  parseArgsPart3,
  parseArgsPart4,
  parseArgsPart5,
  parseArgsPart6,
  parseArgsPart7,
  parseArgsPart8,
  parseArgsPart9,
};

export default argsPart1;
