import { Effect } from "effect";
import { init, parse } from "es-module-lexer";
import { transformSync } from "esbuild";
import type { Loader } from "esbuild";

import type moduleImportsTypes from "./module-imports.types.ts";

type ImportSpecifier = ReturnType<typeof parse>[0][number];

const LOADERS: ReadonlyArray<readonly [RegExp, Loader]> = [
  [/\.tsx$/u, "tsx"],
  [/\.[cm]?ts$/u, "ts"],
];
const QUOTED_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'`]([^"'`$\s]+)["'`]/gu;

const loaderOf = (file: string): Loader =>
  LOADERS.find(([pattern]) => pattern.test(file))?.[1] ?? "js";

const blankImports = (code: string, imports: ReadonlyArray<ImportSpecifier>): string =>
  imports.reduce(
    (rest, entry) =>
      entry.ss < 0
        ? rest
        : `${rest.slice(0, entry.ss)}${" ".repeat(entry.se - entry.ss)}${rest.slice(entry.se)}`,
    code,
  );

const embeddedIn = (code: string, imports: ReadonlyArray<ImportSpecifier>): ReadonlyArray<string> =>
  [...blankImports(code, imports).matchAll(QUOTED_SPECIFIER)].map((match) => match[1] ?? "");

const read = (file: string, text: string): moduleImportsTypes.ModuleImports => {
  const { code } = transformSync(text, {
    loader: loaderOf(file),
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  });
  const [imports] = parse(code);
  return {
    embedded: embeddedIn(code, imports),
    specs: imports.flatMap((entry) => (entry.n === undefined ? [] : [entry.n])),
  };
};

const readImports: moduleImportsTypes.ReadImports = (file, text) =>
  Effect.try({
    catch: (error) => `cannot read the imports of ${file}: ${String(error)}`,
    try: () => read(file, text),
  });

const ready = Effect.promise(() => init);

const moduleImports = { readImports, ready };

export default moduleImports;
