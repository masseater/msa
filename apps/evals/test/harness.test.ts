import { getDocsPath, getExamplesPath, getReadmePath } from "@msa/coding-agent";
import { describe, expect, it } from "vite-plus/test";

import { buildSystemPrompt } from "../../coding-agent/src/core/system-prompt.ts";
import { createMsaDocumentationEvalHarness } from "../src/harness.ts";
import { resolveModelSelection } from "../src/model-selection.ts";
import {
  DOCUMENTATION_EVAL_TOOLS,
  excludeMsaDocumentation,
  resolveDocumentationVariant,
  verifySystemPrompt,
} from "../src/system-prompt.ts";

describe("resolveModelSelection", () => {
  it("prefers an explicit harness model", () => {
    expect(
      resolveModelSelection(
        { provider: "anthropic", id: "claude-opus-4-6" },
        { MSA_PROVIDER: "openai-codex", MSA_MODEL: "gpt-5.6-sol" },
      ),
    ).toEqual({ provider: "anthropic", id: "claude-opus-4-6" });
  });

  it("uses trimmed environment defaults", () => {
    expect(
      resolveModelSelection(undefined, {
        MSA_PROVIDER: " openai-codex ",
        MSA_MODEL: " gpt-5.6-sol ",
      }),
    ).toEqual({
      provider: "openai-codex",
      id: "gpt-5.6-sol",
    });
  });

  it.each([{}, { MSA_PROVIDER: "openai-codex" }, { MSA_MODEL: "gpt-5.6-sol" }])(
    "rejects incomplete model selection",
    (environment) => {
      expect(() => resolveModelSelection(undefined, environment)).toThrow(
        "Select a harness model explicitly",
      );
    },
  );
});

describe("documentation variant", () => {
  it.each(["without_docs", "with_docs"] as const)("accepts %s", (variant) => {
    expect(resolveDocumentationVariant(variant)).toBe(variant);
  });

  it.each([undefined, "", "other"])("rejects invalid variant %s", (variant) => {
    expect(() => resolveDocumentationVariant(variant)).toThrow("MSA_EVAL_VARIANT");
  });
});

describe("documentation system prompt", () => {
  it("strips only the documentation routing section from the default msa prompt", () => {
    const prompt = buildSystemPrompt({
      cwd: "/workspace",
      selectedTools: [...DOCUMENTATION_EVAL_TOOLS],
    });
    expect(prompt).toContain("\n<docs>\nmsa documentation (read only");
    expect(prompt).toContain("\n<rules>\n");
    expect(prompt).toContain("\n<cwd>\n/workspace\n</cwd>");
    expect(prompt).toContain("docs/models.md");

    const stripped = excludeMsaDocumentation(prompt);
    expect(stripped).toContain("\n<rules>\n");
    expect(stripped).toContain("\n<cwd>\n/workspace\n</cwd>");
    expect(stripped).not.toContain("<docs>");
    expect(stripped).not.toContain("msa documentation");
    expect(stripped).not.toContain("docs/models.md");
    expect(stripped).not.toContain(getReadmePath());
    expect(stripped).not.toContain(getDocsPath());
    expect(stripped).not.toContain(getExamplesPath());
  });

  it("verifies the prompt that was sent", () => {
    const prompt = buildSystemPrompt({
      cwd: "/workspace",
      selectedTools: [...DOCUMENTATION_EVAL_TOOLS],
    });
    const stripped = excludeMsaDocumentation(prompt);

    expect(
      verifySystemPrompt(stripped, { name: "without_docs", expectedMsaDocumentation: false }),
    ).toBe(stripped);
    expect(() =>
      verifySystemPrompt(prompt, { name: "without_docs", expectedMsaDocumentation: false }),
    ).toThrow("does not match");
  });

  it("fails closed when prompt markers are missing", () => {
    expect(() => excludeMsaDocumentation("Instructions")).toThrow("no msa documentation section");
    expect(() => excludeMsaDocumentation("\n<docs>\nmsa documentation\n</docs>")).toThrow(
      "no working-directory section",
    );
  });

  it("rejects documentation harnesses outside the container sandbox", () => {
    expect(() => createMsaDocumentationEvalHarness()).toThrow("isolated container sandbox");
  });
});
