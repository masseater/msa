import durable from "@msa/durable";
import harness from "@msa/durable/harness";

import harnessRegistrySupport from "./harness-registry-support.ts";
import type harnessRegistrySupportTypes from "./harness-registry-support.types.ts";

const { defineExtension, section } = durable;
const { createRegistry } = harness;

const { Coding, Skills } = harnessRegistrySupport;

function names(items: readonly { readonly name: string }[]): string[] {
  return items.map((item) => item.name);
}

const Reviewer = defineExtension<harnessRegistrySupportTypes.AppTool>({
  name: "reviewer",
  sections: [section("role", () => "Review.")],
});

function codingRegistry() {
  const installed = createRegistry<harnessRegistrySupportTypes.AppTool>();
  for (const extension of [Coding, Skills, Reviewer]) installed.install(extension);
  return installed;
}

const registry = codingRegistry();

const snapshot = registry.snapshot();

const harnessRegistryCases = {
  Reviewer,
  codingRegistry,
  names,
  registry,
  snapshot,
};

export default harnessRegistryCases;
