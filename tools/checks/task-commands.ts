import type shellSyntaxTypes from "./shell-syntax.types.ts";
import type taskCommandTypes from "./task-commands.types.ts";

type ExportTarget = taskCommandTypes.ExportTarget;
type PackageEntry = taskCommandTypes.PackageEntry;
type RunRef = taskCommandTypes.RunRef;

type NodeFlags = taskCommandTypes.NodeFlags;
type FlagRead = taskCommandTypes.FlagRead;
type NodeRun = taskCommandTypes.NodeRun;
type Parsed = taskCommandTypes.Parsed;
type Word = shellSyntaxTypes.Word;

const HELP_LINE = /^ {2}(-[^ ].*?)(?: {2,}|$)/u;
const FLAG_NAME = /^-{1,2}[\w-]+/u;
const ASSIGNMENT = /^[A-Za-z_]\w*=/u;
const CONDITION_FLAGS = new Set(["-C", "--conditions"]);
const EXEC_PREFIXES: ReadonlyArray<ReadonlyArray<string>> = [
  ["env"],
  ["vp", "exec"],
  ["pnpm", "exec"],
  ["npx"],
];
const RUN_VALUE_FLAGS = new Set(["--concurrency-limit", "--filter"]);
const RUN_SWITCHES = new Set(["--no-cache", "--recursive", "-r"]);

const flagName = (token: string): string => token.match(FLAG_NAME)?.[0] ?? token;

const helpEntries = (spec: string) => {
  const aliases = spec.split(", ");
  const last = aliases.at(-1) ?? "";
  const takesValue = last.charAt(flagName(last).length) === "=";
  return aliases.map((alias) => [flagName(alias), takesValue] as const);
};

const nodeFlags = (help: string): NodeFlags =>
  new Map(
    help.split("\n").flatMap((line) => {
      const spec = HELP_LINE.exec(line)?.[1];
      return spec === undefined ? [] : helpEntries(spec);
    }),
  );

const flagTakesValue = (flags: NodeFlags, name: string): boolean | undefined => {
  const known = flags.get(name);
  if (known !== undefined || !name.startsWith("--no-")) return known;
  return flags.get(`--${name.slice(5)}`) === false ? false : undefined;
};

const isWord = (word: Word | undefined, text: string): boolean =>
  word !== undefined && !word.dynamic && word.text === text;

const withoutPrefix = (rest: ReadonlyArray<Word>, prefix: ReadonlyArray<string>) =>
  prefix.every((text, index) => isWord(rest[index], text)) ? rest.slice(prefix.length) : undefined;

const runsProgram = (stripped: ReadonlyArray<Word> | undefined): boolean =>
  stripped !== undefined && !(stripped[0]?.text ?? "-").startsWith("-");

const isAssignment = (word: Word): boolean => !word.dynamic && ASSIGNMENT.test(word.text);

const programWord = (word: Word): Word =>
  !word.dynamic && word.text.startsWith("/")
    ? { dynamic: false, text: word.text.slice(word.text.lastIndexOf("/") + 1) }
    : word;

const fromProgram = (words: ReadonlyArray<Word>, start: number): ReadonlyArray<Word> => {
  const [program, ...rest] = start === -1 ? [] : words.slice(start);
  return program === undefined ? [] : [programWord(program), ...rest];
};

const unwrap = (words: ReadonlyArray<Word>): ReadonlyArray<Word> => {
  const rest = fromProgram(
    words,
    words.findIndex((word) => !isAssignment(word)),
  );
  const next = EXEC_PREFIXES.map((prefix) => withoutPrefix(rest, prefix)).find(runsProgram);
  return next === undefined ? rest : unwrap(next);
};

const inlineValue = (token: string, name: string): string | undefined =>
  token.startsWith(`${name}=`) ? token.slice(name.length + 1) : undefined;

const valueRead = (name: string, inline: string | undefined, next: string | undefined): FlagRead =>
  inline === undefined ? { name, size: 2, value: next ?? "" } : { name, size: 1, value: inline };

const readFlag = (token: string, next: string | undefined, flags: NodeFlags): FlagRead => {
  const name = flagName(token);
  const takesValue = flagTakesValue(flags, name);
  if (takesValue === undefined) return { problem: `${name} is not a node option` };
  const inline = inlineValue(token, name);
  if (takesValue) return valueRead(name, inline, next);
  return inline === undefined
    ? { name, size: 1, value: "" }
    : { problem: `${name} takes no value` };
};

const collectFlag = (run: NodeRun, name: string, value: string): NodeRun => ({
  conditions: CONDITION_FLAGS.has(name) ? [...run.conditions, value] : run.conditions,
  entries: run.entries,
  preloads: name === "--import" ? [...run.preloads, value] : run.preloads,
});

const entriesFrom = (rest: ReadonlyArray<string>, test: boolean): ReadonlyArray<string> => {
  const files = rest[0] === "--" ? rest.slice(1) : rest;
  return test ? files : files.slice(0, 1);
};

const isEntry = (token: string): boolean => token === "--" || !token.startsWith("-");

const parseFrom = (
  args: ReadonlyArray<string>,
  flags: NodeFlags,
  test: boolean,
  run: NodeRun,
): Parsed => {
  const [token, next] = args;
  if (token === undefined || isEntry(token)) return { ...run, entries: entriesFrom(args, test) };
  const read = readFlag(token, next, flags);
  if ("problem" in read) return read;
  return parseFrom(args.slice(read.size), flags, test, collectFlag(run, read.name, read.value));
};

const parseNode = (args: ReadonlyArray<string>, flags: NodeFlags): Parsed =>
  parseFrom(args, flags, args.includes("--test"), { conditions: [], entries: [], preloads: [] });

const runFlag = (ref: RunRef, name: string, value: string): RunRef => ({
  filters: name === "--filter" ? [...ref.filters, value] : ref.filters,
  name: ref.name,
  recursive: ref.recursive || name === "-r" || name === "--recursive",
});

const runValue = (args: ReadonlyArray<string>, name: string): readonly [string, number] => {
  const token = args[0] ?? "";
  return token.includes("=") ? [token.slice(name.length + 1), 1] : [args[1] ?? "", 2];
};

const readRunFlag = (
  args: ReadonlyArray<string>,
): readonly [string, string, number] | undefined => {
  const name = flagName(args[0] ?? "");
  if (RUN_SWITCHES.has(name)) return [name, "", 1];
  return RUN_VALUE_FLAGS.has(name) ? [name, ...runValue(args, name)] : undefined;
};

type RunRead = RunRef | { readonly problem: string };

const finishRun = (ref: RunRef): RunRead => (ref.name === "" ? { problem: "no task name" } : ref);

const takeRunName = (args: ReadonlyArray<string>, ref: RunRef, name: string): RunRead =>
  ref.name === "" ? parseRunFrom(args.slice(1), { ...ref, name }) : ref;

const takeRunFlag = (args: ReadonlyArray<string>, ref: RunRef, token: string): RunRead => {
  const read = readRunFlag(args);
  if (read === undefined)
    return { problem: `${flagName(token)} is not a vp run option this check knows` };
  return parseRunFrom(args.slice(read[2]), runFlag(ref, read[0], read[1]));
};

function parseRunFrom(args: ReadonlyArray<string>, ref: RunRef): RunRead {
  const [token] = args;
  if (token === undefined || token === "--") return finishRun(ref);
  return token.startsWith("-") ? takeRunFlag(args, ref, token) : takeRunName(args, ref, token);
}

const parseRun = (args: ReadonlyArray<string>): RunRef | { readonly problem: string } =>
  parseRunFrom(args, { filters: [], name: "", recursive: false });

const isBuild = (name: string): boolean => name === "build" || name.endsWith("#build");

const matchesFilter = (filters: ReadonlyArray<string>, name: string): boolean => {
  const includes = filters.filter((filter) => !filter.startsWith("!"));
  const excluded = filters.includes(`!${name}`);
  return !excluded && (includes.length === 0 || includes.includes(name));
};

const patternWildcard = (key: string, subpath: string): string | undefined => {
  const [head, tail] = key.split("*") as [string, string];
  const fits =
    subpath.startsWith(head) &&
    subpath.endsWith(tail) &&
    subpath.length >= head.length + tail.length;
  return fits ? subpath.slice(head.length, subpath.length - tail.length) : undefined;
};

const exportEntry = (
  exportsMap: Readonly<Record<string, ExportTarget>>,
  subpath: string,
): readonly [ExportTarget, string] | undefined => {
  if (subpath in exportsMap) return [exportsMap[subpath] ?? null, ""];
  return Object.keys(exportsMap)
    .filter((key) => key.includes("*"))
    .toSorted((left, right) => right.length - left.length)
    .map((key) => [exportsMap[key] ?? null, patternWildcard(key, subpath)] as const)
    .find((entry): entry is readonly [ExportTarget, string] => entry[1] !== undefined);
};

const pickTarget = (target: ExportTarget, conditions: ReadonlySet<string>): string | undefined => {
  if (target === null) return undefined;
  if (typeof target === "string") return target;
  const matched = Object.entries(target).find(([condition]) => conditions.has(condition));
  return matched === undefined ? undefined : pickTarget(matched[1], conditions);
};

const legacyTarget = (main: string | undefined, subpath: string): string =>
  subpath === "." ? `./${main ?? "index.js"}` : subpath;

const packageTarget = (
  entry: PackageEntry,
  subpath: string,
  conditions: ReadonlySet<string>,
): string | undefined => {
  if (entry.exports === undefined) return legacyTarget(entry.main, subpath);
  const found = exportEntry(entry.exports, subpath);
  if (found === undefined) return undefined;
  return pickTarget(found[0], conditions)?.replaceAll("*", found[1]);
};

const taskCommands = {
  isBuild,
  matchesFilter,
  nodeFlags,
  packageTarget,
  parseNode,
  parseRun,
  unwrap,
};

export default taskCommands;
