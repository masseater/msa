import { Effect, Result } from "effect";
import { createVitest } from "vite-plus/test/node";
import type { TestProject } from "vite-plus/test/node";

import type vitestImportsTypes from "./vitest-imports.types.ts";

type Options = vitestImportsTypes.Options;
type Problems = Effect.Effect<ReadonlyArray<string>>;

interface Visit {
  readonly mocked: ReadonlySet<string>;
  readonly options: Options;
  readonly project: TestProject;
  readonly seen: Set<string>;
}

const MOCK_WITH_FACTORY = /\bvi\.mock\(\s*["']([^"']+)["']\s*,/gu;

const asArray = (value: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> =>
  value === undefined ? [] : typeof value === "string" ? [value] : value;

const entriesOf = (project: TestProject) =>
  Effect.map(
    Effect.promise(() => project.globTestFiles()),
    ({ testFiles }) => [
      ...testFiles,
      ...asArray(project.config.setupFiles),
      ...asArray(project.config.globalSetup),
    ],
  );

const resolveIn = (project: TestProject, spec: string, importer: string) =>
  Effect.result(
    Effect.tryPromise(() =>
      project.vite.environments.ssr.pluginContainer.resolveId(spec, importer),
    ),
  );

const isVirtual = (id: string): boolean => id.startsWith("\0") || id.includes("?");

const idOf = (resolved: { readonly id: string } | null): string | undefined => {
  const id = resolved?.id;
  return id === undefined || isVirtual(id) ? undefined : id;
};

const isSource = (options: Options, file: string): boolean =>
  file.startsWith(options.root) && !file.includes("/node_modules/");

const isBuildOutput = (options: Options, file: string): boolean =>
  isSource(options, file) && options.relative(file).split("/").includes("dist");

const unresolved = (visit: Visit, spec: string, importer: string, reason: string) =>
  visit.options.isWorkspaceSpec(spec)
    ? [`${visit.options.relative(importer)}: vitest cannot resolve ${spec} (${reason})`]
    : [];

const reached = (visit: Visit, spec: string, importer: string, id: string): Problems => {
  const { options } = visit;
  if (isBuildOutput(options, id))
    return Effect.succeed([
      `${options.relative(importer)}: ${spec} resolves to ${options.relative(id)}`,
    ]);
  return isSource(options, id) ? visitFile(visit, id) : Effect.succeed([]);
};

function follow(visit: Visit, spec: string, importer: string): Problems {
  if (visit.mocked.has(spec)) return Effect.succeed([]);
  return Effect.flatMap(resolveIn(visit.project, spec, importer), (result) => {
    if (Result.isFailure(result))
      return Effect.succeed(unresolved(visit, spec, importer, String(result.failure)));
    const id = idOf(result.success);
    return id === undefined
      ? Effect.succeed(unresolved(visit, spec, importer, "no file"))
      : reached(visit, spec, importer, id);
  });
}

const visitKey = (visit: Visit, file: string): string =>
  `${[...visit.mocked].toSorted().join(",")}|${file}`;

function visitFile(visit: Visit, file: string): Problems {
  const key = visitKey(visit, file);
  if (visit.seen.has(key) || file.endsWith(".json")) return Effect.succeed([]);
  visit.seen.add(key);
  return Effect.gen(function* () {
    const text = yield* visit.options.readText(file);
    const imports = yield* visit.options.importsOf(file, text);
    const followed = yield* Effect.forEach(imports.specs, (spec) => follow(visit, spec, file));
    const children = yield* visit.options.childProblems(file, text);
    return [...imports.problems, ...followed.flat(), ...children];
  });
}

const visitEntry = (options: Options, project: TestProject, seen: Set<string>, entry: string) =>
  Effect.flatMap(options.readText(entry), (text) =>
    visitFile(
      {
        mocked: new Set([...text.matchAll(MOCK_WITH_FACTORY)].map((match) => match[1] ?? "")),
        options,
        project,
        seen,
      },
      entry,
    ),
  );

const projectProblems = (options: Options, project: TestProject): Problems =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    const entries = yield* entriesOf(project);
    const problems = yield* Effect.forEach(entries, (entry) =>
      visitEntry(options, project, seen, entry),
    );
    return problems.flat().map((problem) => `[${project.name}] ${problem}`);
  });

const violations = (options: Options): Problems =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createVitest({
        ...(options.projects.length === 0 ? {} : { project: [...options.projects] }),
        root: options.cwd,
        run: true,
        watch: false,
      }),
    ),
    (vitest) =>
      Effect.map(
        Effect.forEach(vitest.projects, (project) => projectProblems(options, project)),
        (problems) => problems.flat(),
      ),
    (vitest) => Effect.promise(() => vitest.close()),
  );

const vitestImports = { violations };

export default vitestImports;
