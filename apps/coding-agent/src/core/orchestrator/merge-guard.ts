import shellWords from "./shell-words.ts";

const { commandsOf } = shellWords;

const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);
const SHELLS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "dash", "fish", "ksh"]);
const GH = /^gh(?:\.exe)?$/iu;
const HTTP_CLIENTS: ReadonlySet<string> = new Set(["curl", "wget", "http", "https", "xh"]);

const REST_MERGE = /\/pulls\/[^\s/]+\/(?:merge|auto-merge)\b/u;
const GRAPHQL_MERGE = /\b(?:mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest)\b/u;
const MCP_MERGE = /(?:^|_)(?:merge_pull_request|enable_(?:pull_request_)?auto_merge)$/u;

const REASON =
  "Workers and reviewers do not merge pull requests or turn on auto-merge: the harness squash-merges a task's pull request at the head the review passed. Leave the pull request pushed and current with its base, then end your turn; the harness waits for CI.";

function baseName(word: string): string {
  return word.slice(Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\")) + 1);
}

function positionals(args: readonly string[]): string[] {
  const found: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "-R" || arg === "--repo") index += 1;
    else if (!arg.startsWith("-")) found.push(arg);
  }
  return found;
}

function mergesWithGh(args: readonly string[]): boolean {
  const [group, command] = positionals(args);
  if (group === "pr") return command === "merge";
  return group === "api" && args.some((arg) => REST_MERGE.test(arg) || GRAPHQL_MERGE.test(arg));
}

function mergesAt(name: string, args: readonly string[], heredoc: string, depth: number): boolean {
  if (GH.test(name)) return mergesWithGh(args);
  if (HTTP_CLIENTS.has(name)) {
    return args.some((arg) => REST_MERGE.test(arg) || GRAPHQL_MERGE.test(arg));
  }
  if (name === "eval") return merges(args.join(" "), depth + 1);
  if (SHELLS.has(name)) {
    const flag = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/u.test(arg));
    const script = flag === -1 ? heredoc : args[flag + 1];
    return script !== undefined && merges(script, depth + 1);
  }
  return false;
}

function merges(command: string, depth = 0): boolean {
  if (depth > 4) return false;
  return commandsOf(command).some(({ heredoc, words }) =>
    words.some((word, index) => mergesAt(baseName(word), words.slice(index + 1), heredoc, depth)),
  );
}

function refusal(toolName: string, args: unknown): string | undefined {
  if (toolName.startsWith("mcp__")) {
    return MCP_MERGE.test(toolName.slice(toolName.lastIndexOf("__") + 2)) ? REASON : undefined;
  }
  if (!SHELL_TOOLS.has(toolName) || typeof args !== "object" || args === null) return undefined;
  const command = (args as { command?: unknown }).command;
  if (typeof command !== "string") return undefined;
  return merges(command) ? REASON : undefined;
}

const mergeGuard = { REASON, refusal };

export default mergeGuard;
