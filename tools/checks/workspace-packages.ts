import { Effect, Schema } from "effect";
import { parse } from "yaml";

import type taskBuildDepsTypes from "./task-build-deps.types.ts";
import taskCommands from "./task-commands.ts";

const { packageTarget } = taskCommands;

type Host = taskBuildDepsTypes.Host;
type Resolution = taskBuildDepsTypes.Resolution;
type Resolved = Effect.Effect<Resolution>;
type Scope = taskBuildDepsTypes.Scope;
type Workspace = taskBuildDepsTypes.Workspace;

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    exports: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    main: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
);
const decodeManifest = Schema.decodeUnknownEffect(Manifest);

const firstFile = (host: Host, candidates: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    for (const candidate of candidates) {
      if (yield* host.isFile(candidate)) return candidate;
    }
    return undefined;
  });

const expandGlob = (host: Host, cwd: string, pattern: string) =>
  Effect.gen(function* () {
    const { path } = host;
    if (!pattern.includes("*")) return [path.resolve(cwd, pattern)];
    const dir = path.resolve(cwd, path.dirname(pattern));
    const [head = "", tail = ""] = path.basename(pattern).split("*");
    const names = yield* host.list(dir);
    return names
      .filter((name) => name.startsWith(head) && name.endsWith(tail))
      .map((name) => path.resolve(dir, name));
  });

const readWorkspace = (host: Host, dir: string) =>
  Effect.gen(function* () {
    const file = host.path.resolve(dir, "package.json");
    if (!(yield* host.isFile(file))) return [];
    const manifest = yield* decodeManifest(yield* host.read(file)).pipe(Effect.orDie);
    const workspace: Workspace = {
      dir,
      exports: manifest.exports as Workspace["exports"],
      main: manifest.main,
      name: manifest.name ?? dir,
      scripts: manifest.scripts ?? {},
    };
    return [workspace];
  });

const loadWorkspaces = (host: Host, root: string) =>
  Effect.gen(function* () {
    const config = parse(yield* host.read(host.path.resolve(root, "pnpm-workspace.yaml"))) as {
      readonly packages: ReadonlyArray<string>;
    };
    const dirs = yield* Effect.forEach(config.packages, (pattern) =>
      expandGlob(host, root, pattern),
    );
    const found = yield* Effect.forEach([root, ...dirs.flat()], (dir) => readWorkspace(host, dir));
    return found.flat();
  });

const findWorkspace = (repo: Scope, spec: string) =>
  repo.workspaces
    .filter((candidate) => spec === candidate.name || spec.startsWith(`${candidate.name}/`))
    .toSorted((left, right) => right.name.length - left.name.length)[0];

const resolveRelative = (repo: Scope, spec: string, from: string): Resolved => {
  const { path } = repo;
  const base = path.resolve(path.dirname(from), spec);
  return Effect.map(
    firstFile(repo, [base, `${base}.ts`, path.resolve(base, "index.ts")]),
    (file) => ({
      file,
    }),
  );
};

const resolvePackage = (
  repo: Scope,
  workspace: Workspace,
  spec: string,
  conditions: ReadonlySet<string>,
): Resolved => {
  const subpath = spec === workspace.name ? "." : `.${spec.slice(workspace.name.length)}`;
  const target = packageTarget(workspace, subpath, conditions);
  if (target === undefined) return Effect.succeed({ problem: `${spec} is not exported` });
  if (target.startsWith("./dist/")) {
    return Effect.succeed({ problem: `${spec} resolves to ${workspace.name}/${target.slice(2)}` });
  }
  const file = repo.path.resolve(workspace.dir, target);
  return Effect.map(firstFile(repo, [file]), (found) => ({ file: found }));
};

const resolveSpec = (
  repo: Scope,
  spec: string,
  from: string,
  conditions: ReadonlySet<string>,
): Resolved => {
  if (spec.startsWith(".")) return resolveRelative(repo, spec, from);
  const workspace = findWorkspace(repo, spec);
  if (workspace === undefined) return Effect.succeed({ file: undefined });
  return resolvePackage(repo, workspace, spec, conditions);
};

const problemOf = (result: Resolution): ReadonlyArray<string> =>
  "problem" in result ? [result.problem] : [];

const fileOf = (result: Resolution): ReadonlyArray<string> =>
  "file" in result && result.file !== undefined ? [result.file] : [];

const relativeTo = (repo: Scope, file: string): string => repo.path.relative(repo.root, file);

const workspacePackages = {
  expandGlob,
  fileOf,
  findWorkspace,
  loadWorkspaces,
  problemOf,
  relativeTo,
  resolveRelative,
  resolveSpec,
};

export default workspacePackages;
