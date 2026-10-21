import settingsManagerSupport from "../../core/settings-manager-support.ts";
import thinkingLevels from "../../core/thinking-levels.ts";
import type argsTypes from "../args.types.ts";

const { getToolListError } = settingsManagerSupport;
const { VALID_THINKING_LEVELS, isValidThinkingLevel } = thinkingLevels;

type Args = argsTypes.Args;
type Handler = (result: Args, next: string | undefined, arg: string) => number | undefined;
type ListKey = "appendSystemPrompt" | "extensions" | "skills" | "promptTemplates" | "themes";

const csv = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter((entry) => entry.length > 0);

const error = (result: Args, message: string): void => {
  result.diagnostics.push({ message, type: "error" });
};

const set =
  (apply: (result: Args) => void): Handler =>
  (result) => {
    apply(result);
    return 0;
  };

const withValue =
  (apply: (result: Args, value: string, arg: string) => void): Handler =>
  (result, next, arg) => {
    if (next === undefined) return undefined;
    apply(result, next, arg);
    return 1;
  };

const appendTo = (key: ListKey): Handler =>
  withValue((result, value) => {
    result[key] = [...(result[key] ?? []), value];
  });

const mode: Handler = (result, next) => {
  if (next === undefined || next.startsWith("-")) {
    error(result, "--mode requires text, json, or rpc");
    return 0;
  }
  if (next === "text" || next === "json" || next === "rpc") result.mode = next;
  else error(result, `Invalid mode "${next}". Valid values: text, json, rpc`);
  return 1;
};

const name: Handler = (result, next) => {
  if (next === undefined) {
    error(result, "--name requires a value");
    return 0;
  }
  result.name = next;
  return 1;
};

const tools = withValue((result, value, arg) => {
  const list = csv(value);
  const problem = getToolListError(list);
  if (problem !== undefined && problem !== "") error(result, `${arg}: ${problem}`);
  else result.tools = list;
});

const thinking = withValue((result, level) => {
  if (isValidThinkingLevel(level)) {
    result.thinking = level;
    return;
  }
  result.diagnostics.push({
    message: `Invalid thinking level "${level}". Valid values: ${VALID_THINKING_LEVELS.join(", ")}`,
    type: "warning",
  });
});

const print: Handler = (result, next) => {
  result.print = true;
  if (next === undefined || next.startsWith("@")) return 0;
  if (next.startsWith("-") && !next.startsWith("---")) return 0;
  result.messages.push(next);
  return 1;
};

const useTheme: Handler = (result, next) => {
  if (next === undefined || next.startsWith("-")) {
    error(result, "--use-theme requires a theme name");
    return 0;
  }
  result.useTheme = next;
  return 1;
};

const listModels: Handler = (result, next) => {
  if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
    result.listModels = next;
    return 1;
  }
  result.listModels = true;
  return 0;
};

const tuiMode: Handler = (result, next) => {
  if (next === "regular" || next === "fullscreen") {
    result.tuiMode = next;
    return 1;
  }
  if (next === undefined || next.startsWith("-")) {
    error(result, "--tui-mode requires regular or fullscreen");
    return 0;
  }
  error(result, `Invalid TUI mode "${next}". Valid values: regular, fullscreen`);
  return 1;
};

const entries: [string[], Handler][] = [
  [["--help", "-h"], set((r) => (r.help = true))],
  [["--version", "-v"], set((r) => (r.version = true))],
  [["--mode"], mode],
  [["--continue", "-c"], set((r) => (r.continue = true))],
  [["--resume", "-r"], set((r) => (r.resume = true))],
  [["--provider"], withValue((r, v) => (r.provider = v))],
  [["--model"], withValue((r, v) => (r.model = v))],
  [["--api-key"], withValue((r, v) => (r.apiKey = v))],
  [["--system-prompt"], withValue((r, v) => (r.systemPrompt = v))],
  [["--append-system-prompt"], appendTo("appendSystemPrompt")],
  [["--name", "-n"], name],
  [["--no-session"], set((r) => (r.noSession = true))],
  [["--session"], withValue((r, v) => (r.session = v))],
  [["--session-id"], withValue((r, v) => (r.sessionId = v))],
  [["--fork"], withValue((r, v) => (r.fork = v))],
  [["--session-dir"], withValue((r, v) => (r.sessionDir = v))],
  [["--models"], withValue((r, v) => (r.models = csv(v)))],
  [["--no-tools", "-nt"], set((r) => (r.noTools = true))],
  [["--no-builtin-tools", "-nbt"], set((r) => (r.noBuiltinTools = true))],
  [
    ["--orchestrator"],
    set((r) =>
      error(
        r,
        "--orchestrator is the default: the orchestrator tools are always enabled. Remove the flag.",
      ),
    ),
  ],
  [["--tools", "-t"], tools],
  [["--exclude-tools", "-xt"], withValue((r, v) => (r.excludeTools = csv(v)))],
  [["--thinking"], thinking],
  [["--print", "-p"], print],
  [["--export"], withValue((r, v) => (r.export = v))],
  [["--extension", "-e"], appendTo("extensions")],
  [["--no-extensions", "-ne"], set((r) => (r.noExtensions = true))],
  [["--no-mcp"], set((r) => (r.noMcp = true))],
  [["--skill"], appendTo("skills")],
  [["--prompt-template"], appendTo("promptTemplates")],
  [["--theme"], appendTo("themes")],
  [["--use-theme"], useTheme],
  [["--no-skills", "-ns"], set((r) => (r.noSkills = true))],
  [["--no-prompt-templates", "-np"], set((r) => (r.noPromptTemplates = true))],
  [["--no-themes"], set((r) => (r.noThemes = true))],
  [["--no-context-files", "-nc"], set((r) => (r.noContextFiles = true))],
  [["--list-models"], listModels],
  [["--tui-mode"], tuiMode],
  [["--verbose"], set((r) => (r.verbose = true))],
  [["--approve", "-a"], set((r) => (r.projectTrustOverride = true))],
  [["--no-approve", "-na"], set((r) => (r.projectTrustOverride = false))],
  [["--offline"], set((r) => (r.offline = true))],
];

const FLAG_HANDLERS: ReadonlyMap<string, Handler> = new Map(
  entries.flatMap(([flags, handler]) => flags.map((flag) => [flag, handler] as const)),
);

const flagHandlers = { FLAG_HANDLERS };

export default flagHandlers;
