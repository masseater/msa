import { expect, it } from "vite-plus/test";

import builtinProvidersModule from "../src/providers/builtin-providers.ts";
import storedProviders from "./stored-providers.ts";

const { builtinProviders } = builtinProvidersModule;
const { STORED_PROVIDERS } = storedProviders;

it("reads stored keys only for providers the catalog still has", () => {
  const ids = new Set(builtinProviders().map((provider) => provider.id));
  expect(STORED_PROVIDERS.filter((id) => !ids.has(id))).toEqual([]);
});
