import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

import { Effect } from "effect";

import type { Facet, FacetDefinition, FacetLoader } from "./host.ts";

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

const toUrl = (module: string | URL): URL =>
  module instanceof URL
    ? new URL(module.href)
    : new URL(module.startsWith("file:") ? module : pathToFileURL(module).href);

const loadFacet = (url: URL, version: string): Effect.Effect<Facet> =>
  Effect.gen(function* () {
    const name = url.href;
    url.searchParams.set(PARAM, version);
    const loaded = yield* Effect.promise(
      () => import(url.href) as Promise<{ default?: FacetDefinition }>,
    );
    const definition = loaded.default;
    if (definition === undefined || typeof definition.setup !== "function") {
      throw new TypeError(`${name}: default export must be a facet (defineFacet)`);
    }
    return { name, setup: definition.setup, uses: definition.uses };
  });

export const nodeLoader: FacetLoader = (modules) =>
  Effect.runPromise(
    Effect.gen(function* () {
      hook();
      generation += 1;
      const version = String(generation);
      const urls = modules.map((module) => {
        const url = toUrl(module);
        url.search = "";
        return url;
      });
      for (const url of urls) roots.add(new URL(".", url).href);
      return yield* Effect.forEach(urls, (url) => loadFacet(url, version));
    }),
  );
