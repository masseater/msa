import type modelResolverCasesTypes from "./model-resolver-cases.types.ts";

const referenceCases: modelResolverCasesTypes.ReferenceCase[] = [
  {
    expected: { model: "anthropic/claude-sonnet-4-5" },
    name: "exact id",
    text: "claude-sonnet-4-5",
  },
  { expected: { model: "openai/gpt-4o" }, name: "exact id is case-insensitive", text: "GPT-4O" },
  {
    expected: { model: "anthropic/claude-sonnet-4-5" },
    name: "fuzzy prefers aliases over dated ids",
    text: "sonnet",
  },
  {
    expected: { model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" },
    name: "thinking suffix",
    text: "sonnet:high",
  },
  {
    expected: { model: "openrouter/qwen/qwen3-coder:exacto" },
    name: "colon in a literal id is not a thinking suffix",
    text: "qwen/qwen3-coder:exacto",
  },
  {
    expected: { model: "openrouter/qwen/qwen3-coder:exacto", thinkingLevel: "high" },
    name: "provider prefix, colon id, and thinking suffix",
    text: "openrouter/qwen/qwen3-coder:exacto:high",
  },
  {
    expected: { model: "openrouter/openai/gpt-4o:extended" },
    name: "raw id wins when the provider prefix names no matching model",
    text: "openai/gpt-4o:extended",
  },
  {
    expected: { model: "openrouter/qwen/qwen3-coder:exacto" },
    name: "fuzzy searches the prefixed provider first",
    text: "openrouter/qwen",
  },
  {
    expected: "not-found",
    name: "strict keeps an invalid suffix in the id",
    text: "gpt-4o:random",
  },
  {
    expected: { model: "openai/gpt-4o", warning: 'Invalid thinking level "random"' },
    name: "lenient drops an invalid suffix with a warning",
    text: "gpt-4o:random",
    thinkingSuffix: "lenient",
  },
  {
    expected: {
      model: "openrouter/qwen/qwen3-coder:exacto",
      warning: 'Invalid thinking level "random"',
    },
    name: "lenient invalid outer suffix discards the inner thinking level",
    text: "qwen/qwen3-coder:exacto:high:random",
    thinkingSuffix: "lenient",
  },
  {
    expected: "not-found",
    name: "none keeps the suffix in the id",
    text: "gpt-4o:high",
    thinkingSuffix: "none",
  },
  { expected: "not-found", fuzzy: false, name: "exact-only skips fuzzy matches", text: "sonnet" },
  { expected: "not-found", name: "empty text", text: "  " },

  {
    expected: { model: "gw-b/shared" },
    name: "sole usable provider wins",
    text: "shared",
    usable: ["gw-b"],
  },
  {
    expected: { ambiguous: ["gw-a/shared", "gw-b/shared"], usableCount: 0 },
    name: "no usable provider is ambiguous instead of falling through to fuzzy",
    text: "shared",
  },
  {
    expected: { ambiguous: ["gw-a/shared", "gw-b/shared"], usableCount: 2 },
    name: "several usable providers are ambiguous",
    text: "shared",
    usable: ["gw-a", "gw-b"],
  },
  {
    expected: { model: "gw-b/shared", thinkingLevel: "high" },
    name: "thinking suffix does not change provider selection",
    text: "shared:high",
    usable: ["gw-b"],
  },
  {
    expected: { ambiguous: ["gw-a/shared", "gw-b/shared"], usableCount: 2 },
    name: "thinking suffix does not bypass ambiguity",
    text: "shared:high",
    usable: ["gw-a", "gw-b"],
  },
  {
    expected: { model: "gw-b/anthropic/future" },
    name: "provider prefix without a direct model selects the usable raw id",
    text: "anthropic/future",
    usable: ["gw-b"],
  },
  {
    expected: { model: "anthropic/exact" },
    name: "usable qualified match beats a usable raw id",
    text: "anthropic/exact",
    usable: ["anthropic-api", "gw-a"],
  },
  {
    expected: { model: "gw-a/anthropic/exact" },
    name: "usable raw id beats an unusable qualified match",
    text: "anthropic/exact",
    usable: ["gw-a"],
  },
  {
    expected: { model: "anthropic/exact" },
    name: "unusable qualified match is kept when nothing is usable",
    text: "anthropic/exact",
  },

  {
    expected: { model: "anthropic/claude-opus-4-8" },
    name: "named provider's usable fuzzy match beats a raw id elsewhere",
    text: "anthropic/claude-opus",
    usable: ["anthropic-api"],
  },
  {
    expected: { model: "gw-a/anthropic/claude-opus" },
    name: "usable raw id beats the named provider's unusable fuzzy match",
    text: "anthropic/claude-opus",
    usable: ["gw-a"],
  },
  {
    expected: { model: "anthropic/claude-opus-4-8" },
    name: "named provider's fuzzy match is kept when nothing is usable",
    text: "anthropic/claude-opus",
  },
  {
    expected: { model: "gw-b/gw-b/free" },
    name: "named provider's literal id beats its fuzzy matches",
    text: "gw-b/free",
  },

  {
    expected: { model: "gw-a/anthropic/claude-opus-4.8" },
    name: "fuzzy prefers usable providers",
    text: "opus",
    usable: ["gw-a"],
  },
  {
    expected: { ambiguous: ["anthropic/claude-opus-4-8", "gw-b/claude-opus-4-8"], usableCount: 2 },
    name: "fuzzy id tie across usable providers is ambiguous",
    text: "opus",
    usable: ["anthropic-api", "gw-a", "gw-b"],
  },
  {
    expected: { model: "anthropic/claude-opus-4-8" },
    name: "fuzzy id tie resolves to the sole usable provider",
    text: "opus",
    usable: ["anthropic-api"],
  },

  {
    expected: { model: "gw-a/shared" },
    name: "explicit provider ignores usable providers elsewhere",
    provider: "gw-a",
    text: "shared",
    usable: ["gw-b"],
  },
  {
    expected: { model: "gw-b/shared" },
    name: "explicit provider accepts its own prefix",
    provider: "gw-b",
    text: "GW-B/shared",
  },
  {
    expected: { model: "openai/gpt-4o" },
    name: "explicit provider allows fuzzy matches",
    provider: "openai",
    text: "4o",
  },
  {
    expected: "not-found",
    name: "explicit provider never leaves the provider",
    provider: "gw-a",
    text: "gpt-4o",
  },
];

const modelResolverCases = {
  referenceCases,
};

export default modelResolverCases;
