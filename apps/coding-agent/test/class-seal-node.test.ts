import { expect, it } from "vite-plus/test";

import classSealProcess from "./class-seal-process.ts";
import classSealSources from "./class-seal-sources.ts";

const { runNode } = classSealProcess;
const { expectedSealed, packageRoot } = classSealSources;

type Layout = (module: string) => string;

const distOf: Layout = (module) => `${packageRoot}/dist/${module.replace(/^src\//u, "")}.js`;

const sourceOf: Layout = (module) => `${packageRoot}/${module}.ts`;

const sourceResolver = `${packageRoot}/src/experimental/source-resolver.ts`;

const loadAllScript = (layout: Layout, modules: readonly string[]): string =>
  [
    `import seal from ${JSON.stringify(layout("src/core/platform/node/class-seal"))};`,
    ...modules.map((module) => `import ${JSON.stringify(layout(module))};`),
    "process.stdout.write(JSON.stringify(Object.fromEntries(seal.sealedModules())));",
  ].join("\n");

const loadAll = (layout: Layout, flags: readonly string[]) =>
  expectedSealed()
    .then(({ counts }) =>
      runNode(
        [...flags, "--input-type=module", "--eval", loadAllScript(layout, Object.keys(counts))],
        packageRoot,
      ).then((result) => ({ counts, result })),
    )
    .then(({ counts, result }) => {
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual(counts);
      return undefined;
    });

it("seals every class of src when node loads every module of the built dist", () =>
  loadAll(distOf, []));

it("seals every class of src when the development runtime loads every source module", () =>
  loadAll(sourceOf, ["--import", sourceResolver]));
