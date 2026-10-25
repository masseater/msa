import { Effect } from "effect";

import harnessConfig from "../../.claude/vite.config.ts";
import codingAgentConfig from "../../apps/coding-agent/vite.config.ts";
import aiConfig from "../../libs/ai/vite.config.ts";
import viteConfig from "../../vite.config.ts";
import libConfigs from "./lib-configs.ts";
import type shellSyntaxTypes from "./shell-syntax.types.ts";
import type taskBuildDepsTypes from "./task-build-deps.types.ts";
import taskCommands from "./task-commands.ts";
import taskPrograms from "./task-programs.ts";

const { afterBuild, checkProgram, failed, isBuild, ok } = taskPrograms;
const { taskCommand } = taskCommands;

type Checked = taskBuildDepsTypes.Checked;
type Graph = taskBuildDepsTypes.Graph;
type Problems = taskBuildDepsTypes.Problems;
type Step = taskBuildDepsTypes.Step;
type TaskDef = taskBuildDepsTypes.TaskDef;
type Tasks = taskBuildDepsTypes.Tasks;
type Walker = taskBuildDepsTypes.Walker;
type Item = shellSyntaxTypes.Item;
type Link = shellSyntaxTypes.Link;
type Script = shellSyntaxTypes.Script;
type Simple = shellSyntaxTypes.Simple;

type TaskConfig = NonNullable<NonNullable<typeof viteConfig.run>["tasks"]>[string];

interface Progress {
  readonly end: Step;
  readonly problems: ReadonlyArray<string>;
  readonly start: Step;
}

const taskObject = (task: TaskConfig) =>
  typeof task === "string" || Array.isArray(task) ? { command: task } : task;

const depName = (dep: string | { readonly task: string }): string =>
  typeof dep === "string" ? dep : dep.task;

const isPatternList = (input: unknown): input is ReadonlyArray<string> =>
  Array.isArray(input) && input.every((entry) => typeof entry === "string");

const inputOf = (cache: unknown): unknown =>
  typeof cache === "object" && cache !== null && "input" in cache ? cache.input : undefined;

const declaredInputs = (cache: unknown): ReadonlyArray<string> | undefined => {
  const input = inputOf(cache);
  return isPatternList(input) ? input : undefined;
};

const toTaskDef = (task: TaskConfig): TaskDef => {
  const def = taskObject(task);
  return {
    command: taskCommand(def),
    cwd: def.cwd ?? ".",
    dependsOn: (def.dependsOn ?? []).map(depName),
    inputs: declaredInputs("cache" in def ? def.cache : undefined),
  };
};

const packageConfigs = {
  ...libConfigs,
  ".claude": harnessConfig,
  "apps/coding-agent": codingAgentConfig,
  "libs/ai": aiConfig,
};

const packageTasks: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.fromEntries(
  Object.entries(packageConfigs).map(([dir, config]) => [
    dir,
    Object.fromEntries(
      Object.entries(config.run?.tasks ?? {}).map(([name, task]) => [
        name,
        taskCommand(taskObject(task)),
      ]),
    ),
  ]),
);

const loadTasks = (): Tasks =>
  Object.fromEntries(
    Object.entries(viteConfig.run?.tasks ?? {}).map(([name, task]) => [name, toTaskDef(task)]),
  );

const dependsOnBuild = (graph: Graph, name: string, seen: ReadonlySet<string>): boolean => {
  const task = graph.tasks[name];
  if (task === undefined || seen.has(name)) return false;
  const next = new Set([...seen, name]);
  return task.dependsOn.some((dep) => isBuild(dep) || dependsOnBuild(graph, dep, next));
};

const walkerOf = (graph: Graph): Walker => ({
  run: (step, name) => checkRun(graph, step, name),
  script: (step, script) => checkScript(graph, step, script),
});

function checkSimple(graph: Graph, step: Step, simple: Simple): Effect.Effect<Checked> {
  return Effect.gen(function* () {
    const substituted = yield* Effect.forEach(simple.substitutions, (script) =>
      checkScript(graph, step, script),
    );
    const checked = yield* checkProgram(walkerOf(graph), graph, step, simple);
    return ok(checked.end, [
      ...substituted.flatMap((inner) => inner.problems),
      ...checked.problems,
    ]);
  });
}

function checkItem(graph: Graph, step: Step, item: Item): Effect.Effect<Checked> {
  if (step.built) return Effect.succeed(ok(step));
  if (item.kind === "unreadable")
    return Effect.succeed(failed(step, item.text, `cannot read ${item.syntax}`));
  if (item.kind === "simple") return checkSimple(graph, step, item);
  return Effect.map(checkScript(graph, step, item.body), (checked) =>
    ok(item.isolated ? afterBuild(step, checked.end.built) : checked.end, checked.problems),
  );
}

const STARTS: Readonly<Record<Link, (progress: Progress) => Step>> = {
  and: (progress) => progress.end,
  concurrent: (progress) => progress.start,
  or: (progress) => ({ ...progress.end, built: progress.start.built }),
  seq: (progress) => progress.end,
  start: (progress) => progress.end,
};

function checkScript(graph: Graph, step: Step, script: Script): Effect.Effect<Checked> {
  const initial: Progress = { end: step, problems: [], start: step };
  return Effect.map(
    Effect.reduce(
      script,
      () => initial,
      (progress, next) => {
        const start = STARTS[next.link](progress);
        return Effect.map(checkItem(graph, start, next.item), (checked) => ({
          end: checked.end,
          problems: [...progress.problems, ...checked.problems],
          start,
        }));
      },
    ),
    (progress) => ok(progress.end, progress.problems),
  );
}

function checkCommand(graph: Graph, step: Step, command: string): Problems {
  return Effect.map(checkScript(graph, step, graph.parse(command)), (checked) => checked.problems);
}

function checkTask(graph: Graph, step: Step, name: string, task: TaskDef): Problems {
  const built = step.built || dependsOnBuild(graph, name, new Set());
  const cwd = graph.resolve(step.workspace.dir, task.cwd);
  return checkCommand(graph, { ...step, built, cwd, inputs: task.inputs }, task.command);
}

function checkScriptOf(graph: Graph, step: Step, name: string): Problems {
  const script = step.workspace.scripts[name];
  return script === undefined ? Effect.succeed([]) : checkCommand(graph, step, script);
}

function checkRun(graph: Graph, step: Step, name: string): Problems {
  const key = `${step.workspace.name}#${name}`;
  if (step.via.includes(key)) return Effect.succeed([]);
  const next = { ...step, via: [...step.via, key] };
  const task = step.workspace.dir === graph.root ? graph.tasks[name] : undefined;
  return task === undefined ? checkScriptOf(graph, next, name) : checkTask(graph, next, name, task);
}

const taskGraph = { checkRun, loadTasks, packageTasks };

export default taskGraph;
