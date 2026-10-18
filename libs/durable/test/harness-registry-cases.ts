import { defineExtension, section } from "@msa/durable";
import { createRegistry } from "@msa/durable/harness";

import { Skills, type AppTool, Coding } from "./harness-registry-support.ts";

export function names(items: readonly { readonly name: string }[]): string[] {
  return items.map((item) => item.name);
}

export const Reviewer = defineExtension<AppTool>({
  name: "reviewer",
  sections: [section("role", () => "Review.")],
});

export function codingRegistry() {
  const installed = createRegistry<AppTool>();
  for (const extension of [Coding, Skills, Reviewer]) installed.install(extension);
  return installed;
}

export const registry = codingRegistry();

export const snapshot = registry.snapshot();
