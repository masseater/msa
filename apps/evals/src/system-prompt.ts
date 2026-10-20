import { dual } from "effect/Function";

import type harnessTypesTypes from "./harness-types.ts";
import type planTypes from "./plan.types.ts";

const DOCUMENTATION_EVAL_TOOLS = ["read", "write", "edit", "grep", "find", "ls"] as const;

const verifySystemPrompt: {
  (
    options: Pick<
      harnessTypesTypes.MsaCodingAgentHarnessOptions,
      "name" | "expectedMsaDocumentation"
    >,
  ): (systemPrompt: string) => string;
  (
    systemPrompt: string,
    options: Pick<
      harnessTypesTypes.MsaCodingAgentHarnessOptions,
      "name" | "expectedMsaDocumentation"
    >,
  ): string;
} = dual(
  2,
  (
    systemPrompt: string,
    options: Pick<
      harnessTypesTypes.MsaCodingAgentHarnessOptions,
      "name" | "expectedMsaDocumentation"
    >,
  ): string => {
    if (options.expectedMsaDocumentation === undefined) return systemPrompt;
    if (!systemPrompt.includes("\n<rules>\n")) {
      throw new Error(`msa system prompt lost its rules in the ${options.name} eval variant.`);
    }
    const hasDocumentation = systemPrompt.includes("\n<docs>\nmsa documentation (read only");
    if (hasDocumentation !== options.expectedMsaDocumentation) {
      throw new Error(`msa system prompt does not match the ${options.name} eval variant.`);
    }
    return systemPrompt;
  },
);

function resolveDocumentationVariant(value: string | undefined): planTypes.DocumentationVariant {
  if (value === "without_docs" || value === "with_docs") return value;
  throw new TypeError('MSA_EVAL_VARIANT must be "without_docs" or "with_docs".');
}

function excludeMsaDocumentation(defaultPrompt: string): string {
  const documentationStartMarker = "\n<docs>\n";
  const documentationEndMarker = "\n</docs>";
  const documentationStart = defaultPrompt.indexOf(documentationStartMarker);
  if (documentationStart === -1) {
    throw new Error("Default msa system prompt has no msa documentation section.");
  }
  const documentationEnd = defaultPrompt.indexOf(documentationEndMarker, documentationStart);
  if (documentationEnd === -1) {
    throw new Error("Default msa system prompt has no complete msa documentation section.");
  }
  const cwdStart = defaultPrompt.lastIndexOf("\n<cwd>\n");
  if (cwdStart < documentationEnd) {
    throw new Error("Default msa system prompt has no working-directory section.");
  }
  return (
    defaultPrompt.slice(0, documentationStart) +
    defaultPrompt.slice(documentationEnd + documentationEndMarker.length)
  );
}

const systemPrompt = {
  DOCUMENTATION_EVAL_TOOLS,
  excludeMsaDocumentation,
  resolveDocumentationVariant,
  verifySystemPrompt,
};

export default systemPrompt;
