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

const resolveSpec = (host: HostShape, root: string, spec: string, fromFile: string) =>
  Effect.gen(function* () {
    if (spec.startsWith("node:")) return undefined;
    if (spec.startsWith(".")) {
      const base = host.resolve(host.dirname(fromFile), spec);
      return yield* firstExistingFile(host, [base, `${base}.ts`, `${base}/index.ts`]);
    }
    for (const [name, src] of Object.entries(WORKSPACE)) {
      if (spec === name) return host.resolve(root, src, "index.ts");
      if (spec.startsWith(`${name}/`)) {
        const tail = spec.slice(name.length + 1);
        return yield* firstExistingFile(
          host,
          [`${tail}.ts`, `${tail}/index.ts`, tail].map((candidate) =>
            host.resolve(root, src, candidate),
          ),
        );
      }
    }
    return undefined;
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

const budgetViolations = (
  pkgDir: string,
  name: string,
  graph: ReadonlyArray<string>,
  budget: EntryBudget,
): ReadonlyArray<string> => {
  const violations: Array<string> = [];
  if (graph.length > budget.maxFiles) {
    violations.push(
      `${pkgDir} export "${name}" reaches ${graph.length} files, budget ${budget.maxFiles}\n${graph.map((file) => `    ${file}`).join("\n")}`,
    );
  }
  for (const pattern of budget.forbid ?? []) {
    const hit = graph.filter((file) => file.includes(pattern));
    if (hit.length > 0) {
      violations.push(
        `${pkgDir} export "${name}" must not reach ${pattern}:\n${hit.map((file) => `    ${file}`).join("\n")}`,
      );
    }
  }
  return violations;
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
