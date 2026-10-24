import { Effect } from "effect";

import moduleImports from "./module-imports.ts";
import type taskBuildDepsTypes from "./task-build-deps.types.ts";
import type taskCommandTypes from "./task-commands.types.ts";
import type vitestImportsTypes from "./vitest-imports.types.ts";
import workspacePackages from "./workspace-packages.ts";

const { expandGlob, fileOf, findWorkspace, problemOf, relativeTo, resolveRelative, resolveSpec } =
  workspacePackages;

type Imports = vitestImportsTypes.Imports;
type Problems = taskBuildDepsTypes.Problems;
type Scope = taskBuildDepsTypes.Scope;
type Step = taskBuildDepsTypes.Step;

interface Walk {
  readonly conditions: ReadonlySet<string>;
  readonly resolver: boolean;
  readonly seen: Set<string>;
}

const SOURCE_RESOLVER = "apps/coding-agent/src/experimental/source-resolver.ts";
const RUNTIME_CONDITIONS = ["default", "import", "node"];
const SOURCE_CONDITION = /--conditions[= ]source\b/u;
const URL_REF = /new URL\(\s*["'`]([^"'`$]+)["'`]\s*,\s*import\.meta\.url\s*\)/gu;
const DIRNAME_REF =
  /\b(?:join|resolve)\(\s*import\.meta\.dirname\s*((?:,\s*["'][^"'$]+["']\s*)+)\)/gu;
const SEGMENT = /["']([^"']+)["']/gu;
const SCRIPT = /\.[cm]?[jt]s$/u;
const STARTS_NODE = /process\.execPath|\b(?:spawn|execFile|exec)\w*\(\s*["'`]node["'`]/u;

const resolverOf = (repo: Scope): string => repo.path.resolve(repo.root, SOURCE_RESOLVER);

const readImports = (repo: Scope, file: string, text: string): Effect.Effect<Imports> =>
  Effect.match(moduleImports.readImports(relativeTo(repo, file), text), {
    onFailure: (problem) => ({ embedded: [], problems: [problem], specs: [] }),
    onSuccess: (found) => ({ embedded: found.embedded, problems: [], specs: found.specs }),
  });

const importsOf = (repo: Scope, file: string, text: string): Effect.Effect<Imports> => {
  const known = repo.imports.get(file);
  if (known !== undefined) return Effect.succeed(known);
  return Effect.map(readImports(repo, file, text), (imports) => {
    repo.imports.set(file, imports);
    return imports;
  });
};

const segmentsOf = (match: RegExpExecArray): ReadonlyArray<string> =>
  [...(match[1] ?? "").matchAll(SEGMENT)].map((segment) => segment[1] ?? "");

const pathRefs = (repo: Scope, file: string, text: string): ReadonlyArray<string> => {
  const dir = repo.path.dirname(file);
  const fromUrls = [...text.matchAll(URL_REF)].map((match) =>
    repo.path.resolve(dir, match[1] ?? ""),
  );
  const fromDirname = [...text.matchAll(DIRNAME_REF)].map((match) =>
    repo.path.resolve(dir, ...segmentsOf(match)),
  );
  return [...new Set([...fromUrls, ...fromDirname])].filter((ref) => ref !== file);
};

const childWalk = (
  repo: Scope,
  text: string,
  refs: ReadonlyArray<string>,
  seen: Set<string>,
): Walk => ({
  conditions: new Set([...RUNTIME_CONDITIONS, ...(SOURCE_CONDITION.test(text) ? ["source"] : [])]),
  resolver: refs.includes(resolverOf(repo)),
  seen,
});

const childScripts = (repo: Scope, refs: ReadonlyArray<string>) =>
  Effect.filter(
    refs.filter((ref) => SCRIPT.test(ref) && ref !== resolverOf(repo)),
    (ref) => repo.isFile(ref),
  );

const importsStartingNode = (repo: Scope, file: string, text: string) =>
  Effect.gen(function* () {
    const { specs } = yield* importsOf(repo, file, text);
    const local = yield* Effect.forEach(
      specs.filter((spec) => spec.startsWith(".")),
      (spec) => resolveRelative(repo, spec, file),
    );
    const texts = yield* Effect.forEach(local.flatMap(fileOf), (helper) => repo.read(helper));
    return texts.some((helper) => STARTS_NODE.test(helper));
  });

const startsNode = (repo: Scope, file: string, text: string): Effect.Effect<boolean> =>
  STARTS_NODE.test(text) ? Effect.succeed(true) : importsStartingNode(repo, file, text);

const embeddedProblems = (repo: Scope, file: string, walk: Walk, embedded: ReadonlyArray<string>) =>
  Effect.map(
    Effect.forEach(
      embedded.filter((spec) => findWorkspace(repo, spec) !== undefined && !walk.resolver),
      (spec) => resolveSpec(repo, spec, file, walk.conditions),
    ),
    (results) => results.flatMap(problemOf),
  );

const inChild = (repo: Scope, file: string, started: string) => (problem: string) =>
  `${relativeTo(repo, file)} starts ${started} in a node process, ` +
  `which does not inherit --conditions or --import: ${problem}`;

function childProblems(repo: Scope, file: string, text: string, seen: Set<string>): Problems {
  return Effect.gen(function* () {
    if (!(yield* startsNode(repo, file, text))) return [];
    const refs = pathRefs(repo, file, text);
    const walk = childWalk(repo, text, refs, seen);
    const children = yield* childScripts(repo, refs);
    const nested = yield* Effect.forEach(children, (child) =>
      Effect.map(visit(repo, child, walk), (problems) =>
        problems.map(inChild(repo, file, relativeTo(repo, child))),
      ),
    );
    const { embedded } = yield* importsOf(repo, file, text);
    const inline = yield* embeddedProblems(repo, file, walk, embedded);
    return [...nested.flat(), ...inline.map(inChild(repo, file, "code"))];
  });
}

const walkKey = (walk: Walk, file: string): string =>
  `${[...walk.conditions].toSorted().join(",")}|${walk.resolver}|${file}`;

function visit(repo: Scope, file: string, walk: Walk): Problems {
  return Effect.gen(function* () {
    const key = walkKey(walk, file);
    if (walk.seen.has(key) || file.endsWith(".json")) return [];
    walk.seen.add(key);
    const text = yield* repo.read(file);
    const imports = yield* importsOf(repo, file, text);
    const specs = imports.specs.filter((spec) => !(walk.resolver && spec.startsWith("@msa/")));
    const results = yield* Effect.forEach(specs, (spec) =>
      resolveSpec(repo, spec, file, walk.conditions),
    );
    const nested = yield* Effect.forEach(results.flatMap(fileOf), (child) =>
      visit(repo, child, walk),
    );
    const children = yield* childProblems(repo, file, text, walk.seen);
    const importer = relativeTo(repo, file);
    return [
      ...imports.problems,
      ...results.flatMap(problemOf).map((problem) => `${importer}: ${problem}`),
      ...nested.flat(),
      ...children,
    ];
  });
}

const walkImports = (
  repo: Scope,
  entry: string,
  conditions: ReadonlySet<string>,
  resolver: boolean,
): Problems => visit(repo, entry, { conditions, resolver, seen: new Set() });

const entryProblems = (repo: Scope, entries: ReadonlyArray<string>, files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (entries.length === 0) return ["no file"];
    const missing = yield* Effect.filter(files, (file) =>
      Effect.map(repo.isFile(file), (ok) => !ok),
    );
    const names = missing.map((file) => relativeTo(repo, file)).join(", ");
    return missing.length === 0 ? [] : [`${names} does not exist`];
  });

const walkRun = (repo: Scope, step: Step, run: taskCommandTypes.NodeRun, label: string): Problems =>
  Effect.gen(function* () {
    const { path } = repo;
    const conditions = new Set([...RUNTIME_CONDITIONS, ...run.conditions]);
    const preloads = run.preloads.map((preload) => path.resolve(step.cwd, preload));
    const resolver = preloads.includes(resolverOf(repo));
    const entries = (yield* Effect.forEach(run.entries, (entry) =>
      expandGlob(repo, step.cwd, entry),
    )).flat();
    const unknown = yield* entryProblems(repo, entries, [...preloads, ...entries]);
    if (unknown.length > 0)
      return unknown.map((problem) => `${label}\n    cannot find the entry: ${problem}`);
    const walks = yield* Effect.forEach(
      [
        ...preloads.map((file) => [file, false] as const),
        ...entries.map((file) => [file, resolver] as const),
      ],
      ([file, withResolver]) => walkImports(repo, file, conditions, withResolver),
    );
    return walks.flat().map((problem) => `${label}\n    ${problem}`);
  });

const nodeImports = {
  childProblems: (repo: Scope, file: string, text: string) =>
    childProblems(repo, file, text, new Set()),
  importsOf,
  ready: moduleImports.ready,
  walkRun,
};

export default nodeImports;
