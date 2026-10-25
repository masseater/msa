import { Effect } from "effect";

import type shellSyntaxTypes from "./shell-syntax.types.ts";
import type taskBuildDepsTypes from "./task-build-deps.types.ts";
import taskCommands from "./task-commands.ts";
import type taskCommandTypes from "./task-commands.types.ts";

const { isBuild, matchesFilter, parseNode, parseRun, unwrap } = taskCommands;

type Call = taskBuildDepsTypes.Call;
type Checked = taskBuildDepsTypes.Checked;
type Graph = taskBuildDepsTypes.Graph;
type Problems = taskBuildDepsTypes.Problems;
type Step = taskBuildDepsTypes.Step;
type Walker = taskBuildDepsTypes.Walker;
type Workspace = taskBuildDepsTypes.Workspace;
type Simple = shellSyntaxTypes.Simple;
type Word = shellSyntaxTypes.Word;
type RunRef = taskCommandTypes.RunRef;
type Handler = (call: Call) => Effect.Effect<Checked>;

const READS_NO_DIST: ReadonlyArray<ReadonlyArray<string>> = [
  ["ast-grep"],
  ["awk"],
  ["cargo"],
  ["echo"],
  ["fallow"],
  ["git"],
  ["go"],
  ["jq"],
  ["syncpack"],
  ["test"],
  ["uvx"],
  ["vp", "check"],
  ["vp", "pm", "audit"],
];
const NODE_OPTIONS = "NODE_OPTIONS";
const NPM_RUN = new Set(["run", "run-script"]);
const VITEST_PROJECT = "--project";
const VITEST_PROJECT_INLINE = /^--project=(.*)$/u;

const labelOf = (step: Step, text: string): string => `${step.via.join(" → ")}: ${text}`;

const ok = (end: Step, problems: ReadonlyArray<string> = []): Checked => ({ end, problems });

const failed = (step: Step, text: string, reason: string): Checked =>
  ok(step, [`${labelOf(step, text)}\n    ${reason}`]);

const refuse = (call: Call, reason: string): Effect.Effect<Checked> =>
  Effect.succeed(failed(call.step, call.text, reason));

const texts = (words: ReadonlyArray<Word>): ReadonlyArray<string> => words.map((word) => word.text);

const isStatic = (words: ReadonlyArray<Word>): boolean => words.every((word) => !word.dynamic);

const isReadable = (word: Word | undefined): word is Word => word !== undefined && !word.dynamic;

const startsWith = (words: ReadonlyArray<string>, prefix: ReadonlyArray<string>): boolean =>
  prefix.every((text, index) => words[index] === text);

const workspaceAt = (graph: Graph, step: Step): Workspace =>
  graph.workspaces
    .filter((workspace) => step.cwd === workspace.dir || step.cwd.startsWith(`${workspace.dir}/`))
    .toSorted((left, right) => right.dir.length - left.dir.length)[0] ?? step.workspace;

const isBuildScript = (name: string): boolean => isBuild(name) || name.startsWith("build:");

const afterBuild = (step: Step, built: boolean): Step => ({ ...step, built: step.built || built });

const afterInner = (call: Call) => (checked: Checked) =>
  ok(afterBuild(call.step, checked.end.built), checked.problems);

function checkNode(call: Call): Effect.Effect<Checked> {
  const run = parseNode(texts(call.args.slice(1)), call.graph.flags);
  if ("problem" in run) return refuse(call, `cannot find the entry: ${run.problem}`);
  return Effect.map(
    call.graph.walkNode(call.step, run, labelOf(call.step, call.text)),
    (problems) => ok(call.step, problems),
  );
}

const runTargets = (graph: Graph, step: Step, ref: RunRef): ReadonlyArray<Workspace> => {
  if (ref.filters.length === 0 && !ref.recursive) return [workspaceAt(graph, step)];
  return graph.workspaces.filter(
    (workspace) =>
      workspace.dir !== graph.root &&
      matchesFilter(ref.filters, workspace.name) &&
      ref.name in workspace.scripts,
  );
};

const runProblems = (call: Call, ref: RunRef): Problems => {
  if (isBuildScript(ref.name)) return Effect.succeed([]);
  return Effect.map(
    Effect.forEach(runTargets(call.graph, call.step, ref), (workspace) =>
      call.walker.run({ ...call.step, cwd: workspace.dir, workspace }, ref.name),
    ),
    (nested) => nested.flat(),
  );
};

function vpRun(call: Call): Effect.Effect<Checked> {
  const args = call.args.slice(2);
  if (!isStatic(args)) return refuse(call, "vp run takes an argument from a variable");
  const ref = parseRun(texts(args));
  if ("problem" in ref) return refuse(call, `cannot read vp run: ${ref.problem}`);
  return Effect.map(runProblems(call, ref), (problems) =>
    ok(afterBuild(call.step, isBuild(ref.name)), problems),
  );
}

type VitestArgs = ReadonlyArray<string> | string;

const vitestToken = (
  args: ReadonlyArray<string>,
  projects: ReadonlyArray<string>,
  token: string,
): VitestArgs => {
  const inline = VITEST_PROJECT_INLINE.exec(token)?.[1];
  if (inline !== undefined) return vitestProjects(args.slice(1), [...projects, inline]);
  return token.startsWith("-") ? token : vitestProjects(args.slice(1), projects);
};

function vitestProjects(args: ReadonlyArray<string>, projects: ReadonlyArray<string>): VitestArgs {
  const [token, value] = args;
  if (token === undefined) return projects;
  if (token === VITEST_PROJECT) return vitestProjects(args.slice(2), [...projects, value ?? ""]);
  return vitestToken(args, projects, token);
}

function vpTest(call: Call): Effect.Effect<Checked> {
  if (!isStatic(call.args)) return refuse(call, "vp test takes an argument from a variable");
  const args = texts(call.args.slice(2));
  const projects = vitestProjects(args[0] === "run" ? args.slice(1) : args, []);
  if (typeof projects === "string")
    return refuse(call, `${projects} is not a vp test option this check knows`);
  const run = { cwd: call.step.cwd, projects };
  return Effect.map(call.graph.walkVitest(run, labelOf(call.step, call.text)), (problems) =>
    ok(call.step, problems),
  );
}

const scriptSource = (script: string, rest: ReadonlyArray<Word>): string =>
  [script, ...rest.map((word) => `'${word.text.replaceAll("'", "'\\''")}'`)].join(" ");

function runWorkspaceScript(
  call: Call,
  workspace: Workspace,
  name: string,
  source: string,
): Effect.Effect<Checked> {
  const key = `${workspace.name}#${name}`;
  if (call.step.via.includes(key)) return Effect.succeed(ok(call.step));
  const inner = { ...call.step, cwd: workspace.dir, via: [...call.step.via, key], workspace };
  return Effect.map(call.walker.script(inner, call.graph.parse(source)), afterInner(call));
}

function runScript(call: Call, name: string, rest: ReadonlyArray<Word>): Effect.Effect<Checked> {
  if (isBuildScript(name)) return Effect.succeed(ok(afterBuild(call.step, true)));
  const workspace = workspaceAt(call.graph, call.step);
  const script = workspace.scripts[name];
  if (script === undefined) return refuse(call, `${name} is not a script of ${workspace.name}`);
  return isStatic(rest)
    ? runWorkspaceScript(call, workspace, name, scriptSource(script, rest))
    : refuse(call, "the script takes an argument from a variable");
}

const scriptCall = (call: Call, words: ReadonlyArray<Word>, tool: string) => {
  const [name, ...rest] = words;
  return isReadable(name) && !name.text.startsWith("-")
    ? runScript(call, name.text, rest)
    : refuse(call, `cannot read the ${tool} command`);
};

const pnpm = (call: Call): Effect.Effect<Checked> =>
  scriptCall(call, call.args.slice(call.args[1]?.text === "run" ? 2 : 1), "pnpm");

const npm = (call: Call): Effect.Effect<Checked> =>
  scriptCall(call, NPM_RUN.has(call.args[1]?.text ?? "") ? call.args.slice(2) : [], "npm");

function shellCode(call: Call, code: Word | undefined): Effect.Effect<Checked> {
  if (code === undefined || code.dynamic) return refuse(call, "the -c code comes from a variable");
  return Effect.map(call.walker.script(call.step, call.graph.parse(code.text)), afterInner(call));
}

function shellFile(call: Call, file: Word): Effect.Effect<Checked> {
  const path = call.graph.resolve(call.step.cwd, file.text);
  const inner = { ...call.step, via: [...call.step.via, call.graph.relative(path)] };
  return Effect.flatMap(call.graph.readScript(path), (source) =>
    source === undefined
      ? refuse(call, `cannot read ${file.text}`)
      : Effect.map(call.walker.script(inner, call.graph.parse(source)), afterInner(call)),
  );
}

function shell(call: Call): Effect.Effect<Checked> {
  const [first, second] = call.args.slice(1);
  if (!isReadable(first)) return refuse(call, "cannot read the shell command");
  if (first.text === "-c") return shellCode(call, second);
  return first.text.startsWith("-")
    ? refuse(call, `${first.text} is not a shell option this check knows`)
    : shellFile(call, first);
}

function cd(call: Call): Effect.Effect<Checked> {
  const [dir, extra] = call.args.slice(1);
  if (dir === undefined || dir.dynamic || extra !== undefined)
    return refuse(call, "cannot tell which directory cd moves to");
  return Effect.succeed(ok({ ...call.step, cwd: call.graph.resolve(call.step.cwd, dir.text) }));
}

const PROGRAMS: Readonly<Record<string, Handler>> = {
  bash: shell,
  cd,
  node: checkNode,
  npm,
  pnpm,
  sh: shell,
  "vp run": vpRun,
  "vp test": vpTest,
};

const handlerOf = (words: ReadonlyArray<string>): Handler | undefined =>
  PROGRAMS[`${words[0]} ${words[1]}`] ?? PROGRAMS[words[0] ?? ""];

const setsNodeOptions = (simple: Simple): boolean =>
  simple.assignments.some((assignment) => assignment.name === NODE_OPTIONS) ||
  simple.words.some((word) => word.text.startsWith(`${NODE_OPTIONS}=`));

const knownProgram = (call: Call, words: ReadonlyArray<string>): Effect.Effect<Checked> => {
  const handler = handlerOf(words);
  if (handler !== undefined) return handler(call);
  if (READS_NO_DIST.some((prefix) => startsWith(words, prefix)))
    return Effect.succeed(ok(call.step));
  return refuse(call, `does not know whether ${words[0]} reads dist`);
};

function checkProgram(
  walker: Walker,
  graph: Graph,
  step: Step,
  simple: Simple,
): Effect.Effect<Checked> {
  const args = unwrap(simple.words);
  const call = { args, graph, step, text: simple.text, walker };
  const [program] = args;
  if (program === undefined) return Effect.succeed(ok(step));
  if (setsNodeOptions(simple)) return refuse(call, `this check does not read ${NODE_OPTIONS}`);
  return program.dynamic
    ? refuse(call, `the program comes from ${program.text}`)
    : knownProgram(call, texts(args));
}

const taskPrograms = { afterBuild, checkProgram, failed, isBuild, ok };

export default taskPrograms;
