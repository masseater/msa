import { Console, Effect, Schema } from "effect";

import { BUDGETS, WORKSPACE } from "./entry-graph-budgets.ts";
import type { EntryBudget } from "./entry-graph-budgets.ts";
import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";

const SPEC = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)([^;]*?\sfrom\s*)?["']([^"']+)["']/gu;

const ExportTarget = Schema.Union([Schema.String, Schema.Struct({ import: Schema.String })]);
const Manifest = Schema.fromJsonString(
  Schema.Struct({
    exports: Schema.optional(Schema.Record(Schema.String, ExportTarget)),
  }),
);
const decodeManifest = Schema.decodeUnknownEffect(Manifest);

const firstExistingFile = (host: HostShape, candidates: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    for (const candidate of candidates) {
      const exists = yield* host.exists(candidate);
      if (exists && (yield* host.stat(candidate)).isFile) return candidate;
    }
    return undefined;
  });

const resolveRelative = (host: HostShape, spec: string, fromFile: string) => {
  const base = host.resolve(host.dirname(fromFile), spec);
  return firstExistingFile(host, [base, `${base}.ts`, `${base}/index.ts`]);
};

const resolveWorkspace = (host: HostShape, root: string, spec: string) =>
  Effect.gen(function* () {
    const workspace = Object.entries(WORKSPACE).find(
      ([name]) => spec === name || spec.startsWith(`${name}/`),
    );
    if (workspace === undefined) return undefined;
    const [name, src] = workspace;
    if (spec === name) return host.resolve(root, src, "index.ts");
    const tail = spec.slice(name.length + 1);
    return yield* firstExistingFile(
      host,
      [`${tail}.ts`, `${tail}/index.ts`, tail].map((candidate) =>
        host.resolve(root, src, candidate),
      ),
    );
  });

const resolveSpec = (host: HostShape, root: string, spec: string, fromFile: string) =>
  Effect.gen(function* () {
    if (spec.startsWith("node:")) return undefined;
    return yield* spec.startsWith(".")
      ? resolveRelative(host, spec, fromFile)
      : resolveWorkspace(host, root, spec);
  });

const walk = (host: HostShape, root: string, entryFile: string) =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    const queue = [entryFile];
    let file = queue.pop();
    while (file !== undefined) {
      if (!seen.has(file) && !file.endsWith(".json")) {
        seen.add(file);
        const source = yield* host.readText(file);
        const importer = file;
        const targets = yield* Effect.forEach(source.matchAll(SPEC), (match) =>
          resolveSpec(host, root, match[2] ?? "", importer),
        );
        queue.push(...targets.filter((target) => target !== undefined));
      }
      file = queue.pop();
    }
    return seen;
  });

const sourceFor = (host: HostShape, root: string, pkgDir: string, distPath: string) =>
  Effect.gen(function* () {
    const rel = distPath.replace(/^\.\/dist\//u, "").replace(/\.js$/u, ".ts");
    const file = host.resolve(root, pkgDir, "src", rel);
    return (yield* host.exists(file)) ? file : undefined;
  });

const expand = (host: HostShape, root: string, pkgDir: string, entry: string, target: string) =>
  Effect.gen(function* () {
    if (!entry.includes("*")) return [[entry, target] as const];
    const dir = host.resolve(root, pkgDir, "src", host.dirname(target.replace(/^\.\/dist\//u, "")));
    if (!(yield* host.exists(dir))) return [];
    const names = yield* host.readDirectory(dir);
    return names
      .filter((name) => name.endsWith(".ts"))
      .map((name) => {
        const stem = name.replace(/\.ts$/u, "");
        return [entry.replace("*", stem), target.replace("*", stem)] as const;
      });
  });

const fileList = (files: ReadonlyArray<string>): string =>
  files.map((file) => `    ${file}`).join("\n");

const sizeViolations = (
  label: string,
  graph: ReadonlyArray<string>,
  budget: EntryBudget,
): ReadonlyArray<string> =>
  graph.length > budget.maxFiles
    ? [`${label} reaches ${graph.length} files, budget ${budget.maxFiles}\n${fileList(graph)}`]
    : [];

const forbiddenViolations = (
  label: string,
  graph: ReadonlyArray<string>,
  budget: EntryBudget,
): ReadonlyArray<string> =>
  (budget.forbid ?? []).flatMap((pattern) => {
    const hit = graph.filter((file) => file.includes(pattern));
    return hit.length > 0 ? [`${label} must not reach ${pattern}:\n${fileList(hit)}`] : [];
  });

const budgetViolations = (
  pkgDir: string,
  name: string,
  graph: ReadonlyArray<string>,
  budget: EntryBudget,
): ReadonlyArray<string> => {
  const label = `${pkgDir} export "${name}"`;
  return [...sizeViolations(label, graph, budget), ...forbiddenViolations(label, graph, budget)];
};

const checkEntry = (
  host: HostShape,
  root: string,
  pkgDir: string,
  [entry, budget]: readonly [string, EntryBudget],
  exportsMap: Readonly<Record<string, typeof ExportTarget.Type>> | undefined,
) =>
  Effect.gen(function* () {
    const declared = exportsMap?.[entry];
    if (declared === undefined) {
      return [`${pkgDir} declares no export "${entry}" but a budget exists for it`];
    }
    const target = typeof declared === "string" ? declared : declared.import;
    const expanded = yield* expand(host, root, pkgDir, entry, target);
    const results = yield* Effect.forEach(expanded, ([name, distPath]) =>
      Effect.gen(function* () {
        const source = yield* sourceFor(host, root, pkgDir, distPath);
        if (source === undefined) {
          return [`${pkgDir} export "${name}" points at ${distPath}, which has no source file`];
        }
        const graph = [...(yield* walk(host, root, source))].map((file) =>
          host.relative(root, file),
        );
        return budgetViolations(pkgDir, name, graph, budget);
      }),
    );
    return results.flat();
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const root = host.resolve(import.meta.dirname, "..");
  const violations = yield* Effect.forEach(Object.entries(BUDGETS), ([pkgDir, budgets]) =>
    Effect.gen(function* () {
      const manifest = yield* decodeManifest(
        yield* host.readText(host.resolve(root, pkgDir, "package.json")),
      );
      const results = yield* Effect.forEach(Object.entries(budgets), (budgetEntry) =>
        checkEntry(host, root, pkgDir, budgetEntry, manifest.exports),
      );
      return results.flat();
    }),
  );
  const failures = violations.flat();
  yield* Effect.forEach(failures, (failure) => Console.error(failure));
  if (failures.length > 0) {
    yield* Console.error(`\n${failures.length} entry-point budget violation(s).`);
    process.exitCode = 1;
    return;
  }
  yield* Console.log("Entry point graphs are within budget.");
});

runScript(program);
