import renderUtils from "./render-utils.ts";

const { formatReadLineRange, shortenPath } = renderUtils;

type Args = Readonly<Record<string, unknown>>;

const text = (value: unknown, fallback = ""): string =>
  value === undefined || value === null || value === "" ? fallback : String(value);

type Shorten = (path: string) => string;

const filePath = (args: Args, shorten: Shorten): string => {
  const path = text(args["path"]);
  return shorten(path === "" ? text(args["file_path"]) : path);
};

const dirPath = (args: Args, shorten: Shorten): string => shorten(text(args["path"], "."));

const command = (args: Args): string => {
  const raw = text(args["command"]);
  const shown = raw
    .replaceAll(/[\n\t]/gu, " ")
    .trim()
    .slice(0, 50);
  return `${shown}${raw.length > 50 ? "..." : ""}`;
};

const SUMMARIES: ReadonlyMap<string, (args: Args, shorten: Shorten) => string> = new Map(
  Object.entries({
    bash: (args: Args) => `[bash: ${command(args)}]`,
    edit: (args: Args, shorten: Shorten) => `[edit: ${filePath(args, shorten)}]`,
    find: (args: Args, shorten: Shorten) =>
      `[find: ${text(args["pattern"])} in ${dirPath(args, shorten)}]`,
    grep: (args: Args, shorten: Shorten) =>
      `[grep: /${text(args["pattern"])}/ in ${dirPath(args, shorten)}]`,
    ls: (args: Args, shorten: Shorten) => `[ls: ${dirPath(args, shorten)}]`,
    read: (args: Args, shorten: Shorten) =>
      `[read: ${filePath(args, shorten)}${formatReadLineRange(args["offset"], args["limit"])}]`,
    write: (args: Args, shorten: Shorten) => `[write: ${filePath(args, shorten)}]`,
  }),
);

const toolCallSummary = (name: string, args: Args, shorten: Shorten = shortenPath): string => {
  const summary = SUMMARIES.get(name);
  if (summary !== undefined) return summary(args, shorten);
  const json = JSON.stringify(args);
  return `[${name}: ${json.slice(0, 40)}${json.length > 40 ? "..." : ""}]`;
};

const toolCallSummaryModule = { toolCallSummary };

export default toolCallSummaryModule;
