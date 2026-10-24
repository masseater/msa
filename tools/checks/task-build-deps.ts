import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Path } from "effect";

import captureProcessModule from "../capture-process.ts";
import nodeImports from "./node-imports.ts";
import shellSyntax from "./shell-syntax.ts";
import type taskBuildDepsTypes from "./task-build-deps.types.ts";
import taskCommands from "./task-commands.ts";
import taskGraph from "./task-graph.ts";
import vitestImports from "./vitest-imports.ts";
import workspacePackages from "./workspace-packages.ts";

const { nodeFlags } = taskCommands;
const { checkRun } = taskGraph;
const { findWorkspace, loadWorkspaces, relativeTo } = workspacePackages;

type Graph = taskBuildDepsTypes.Graph;
type Host = taskBuildDepsTypes.Host;
type Problems = taskBuildDepsTypes.Problems;
type Scope = taskBuildDepsTypes.Scope;
type Scripts = Readonly<Record<string, string>>;
type Tasks = taskBuildDepsTypes.Tasks;
type Workspace = taskBuildDepsTypes.Workspace;

const GRAMMAR = "node_modules/tree-sitter-bash/tree-sitter-bash.wasm";

const walkVitest = (repo: Scope, run: taskBuildDepsTypes.VitestRun, label: string): Problems =>
  Effect.map(
    vitestImports.violations({
      childProblems: (file, text) => nodeImports.childProblems(repo, file, text),
      cwd: run.cwd,
      importsOf: (file, text) => nodeImports.importsOf(repo, file, text),
      isWorkspaceSpec: (spec) => findWorkspace(repo, spec) !== undefined,
      projects: run.projects,
      readText: repo.read,
      relative: (file) => relativeTo(repo, file),
      root: repo.root,
    }),
    (problems) => problems.map((problem) => `${label}\n    ${problem}`),
  );

const withRootScripts = (
  workspaces: ReadonlyArray<Workspace>,
  root: string,
  scripts: Scripts,
): ReadonlyArray<Workspace> =>
  workspaces.map((workspace) =>
    workspace.dir === root
      ? { ...workspace, scripts: { ...workspace.scripts, ...scripts } }
      : workspace,
  );

const makeGraph = (scope: Scope, tasks: Tasks, grammar: Uint8Array) =>
  Effect.gen(function* () {
    const { path, root } = scope;
    const help = yield* captureProcessModule.captureProcess({
      args: ["--help"],
      command: "node",
      cwd: root,
    });
    yield* nodeImports.ready;
    const graph: Graph = {
      flags: nodeFlags(help.stdout),
      parse: yield* shellSyntax.makeParser(grammar),
      readScript: (file) =>
        scope.read(file).pipe(Effect.orElseSucceed((): string | undefined => undefined)),
      relative: (file) => relativeTo(scope, file),
      resolve: (dir, relative) => path.resolve(dir, relative),
      root,
      tasks,
      walkNode: (step, run, label) => nodeImports.walkRun(scope, step, run, label),
      walkVitest: (run, label) => walkVitest(scope, run, label),
      workspaces: scope.workspaces,
    };
    return graph;
  });

const hostOf = (fs: FileSystem.FileSystem, path: Path.Path): Host => ({
  isFile: (file) =>
    fs.stat(file).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    ),
  list: (dir) => fs.readDirectory(dir).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => [])),
  path,
  read: (file) => fs.readFileString(file).pipe(Effect.orDie),
});

const collectViolations = (tasks: Tasks, rootScripts: Scripts) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const host = hostOf(fs, path);
    const root = path.resolve(import.meta.dirname, "../..");
    const workspaces = withRootScripts(yield* loadWorkspaces(host, root), root, rootScripts);
    const rootWorkspace = workspaces.find((workspace) => workspace.dir === root);
    if (rootWorkspace === undefined) return ["no package.json at the repository root"];
    const grammar = yield* fs.readFile(path.resolve(root, GRAMMAR)).pipe(Effect.orDie);
    const scope = { ...host, imports: new Map(), root, workspaces };
    const graph = yield* makeGraph(scope, tasks, grammar);
    const start = { built: false, cwd: root, via: [], workspace: rootWorkspace };
    const results = yield* Effect.forEach(Object.keys(tasks), (name) =>
      checkRun(graph, start, name),
    );
    return [...new Set(results.flat())];
  });

const runtime = ManagedRuntime.make(
  captureProcessModule.processRunnerLayer.pipe(Layer.provideMerge(NodeServices.layer)),
);

const violationsOf = (tasks: Tasks, rootScripts: Scripts = {}): Promise<ReadonlyArray<string>> =>
  runtime.runPromise(collectViolations(tasks, rootScripts));

const taskBuildDeps = { violationsOf };

export default taskBuildDeps;
