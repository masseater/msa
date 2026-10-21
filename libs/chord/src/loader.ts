import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Effect } from "effect";

import type hostTypesModule from "./host-types.types.ts";

const PARAM = "chord2-reload";

const roots = new Set<string>();
let hooked = false;
let generation = 0;

function hook(): void {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      const version =
        context.parentURL === undefined ? null : new URL(context.parentURL).searchParams.get(PARAM);
      if (version === null || !result.url.startsWith("file:")) return result;
      const url = new URL(result.url);
      if (url.searchParams.has(PARAM) || ![...roots].some((root) => url.href.startsWith(root)))
        return result;
      url.searchParams.set(PARAM, version);
      return { ...result, url: url.href };
    },
  });
}

const toPath = (module: string | URL): string =>
  module instanceof URL || module.startsWith("file:") ? fileURLToPath(module) : module;

const loadFacet = (path: string, version: string): Effect.Effect<hostTypesModule.Facet> =>
  Effect.gen(function* () {
    const name = pathToFileURL(path).href;
    const loaded = yield* Effect.promise(
      () =>
        import(`${pathToFileURL(path).href}?${PARAM}=${version}`) as Promise<{
          default?: hostTypesModule.FacetDefinition;
        }>,
    );
    const definition = loaded.default;
    if (definition === undefined || typeof definition.setup !== "function") {
      throw new TypeError(`${name}: default export must be a facet (defineFacet)`);
    }
    return { name, setup: definition.setup, uses: definition.uses };
  });

const nodeLoader: hostTypesModule.FacetLoader = (modules) =>
  Effect.runPromise(
    Effect.gen(function* () {
      hook();
      generation += 1;
      const version = String(generation);
      const paths = modules.map(toPath);
      for (const path of paths) roots.add(new URL(".", pathToFileURL(path)).href);
      return yield* Effect.forEach(paths, (path) => loadFacet(path, version));
    }),
  );

const loader = {
  nodeLoader,
};

export default loader;
