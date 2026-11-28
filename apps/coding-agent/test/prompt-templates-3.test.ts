import { describe, expect, test } from "vite-plus/test";

import promptTemplateArgs from "../src/core/prompt-template-args.ts";
import promptTemplates from "../src/core/prompt-templates.ts";
import promptTemplateArgsSupport from "./prompt-template-args-support.ts";

const { expandPromptTemplate } = promptTemplates;
const { parseCommandArgs, substituteArgs } = promptTemplateArgs;
const { parses } = promptTemplateArgsSupport;

const shouldParseSimpleSpaceSeparatedArguments = parses(["a b c", ["a", "b", "c"]]);

const shouldParseQuotedArgumentsWithSpaces = parses([
  '"first arg" second',
  ["first arg", "second"],
]);

const shouldParseSingleQuotedArguments = parses(["'first arg' second", ["first arg", "second"]]);

const shouldParseMixedQuoteStyles = parses([
  '"double" \'single\' "double again"',
  ["double", "single", "double again"],
]);

const shouldHandleEmptyString = parses(["", []]);

const shouldHandleTabsAsSeparators = parses(["a\tb\tc", ["a", "b", "c"]]);

const shouldHandleQuotedEmptyString = parses(
  ['"" " "', ["", " "]],
  ["a '' c", ["a", "", "c"]],
  ['a ""', ["a", ""]],
);

const shouldHandleArgumentsWithSpecialCharacters = parses([
  "$100 @user #tag",
  ["$100", "@user", "#tag"],
]);

const shouldHandleUnicodeCharacters2 = parses(["日本語 🎉 café", ["日本語", "🎉", "café"]]);

const shouldHandleNewlinesInQuotedArguments = parses([
  '"line1\nline2" second',
  ["line1\nline2", "second"],
]);

const shouldTreatUnquotedNewlinesAsSeparators = parses([
  "label-2\n\nHere is some description #2.",
  ["label-2", "Here", "is", "some", "description", "#2."],
]);

const shouldCollapseMixedUnquotedWhitespace = parses(["a\n\n\tb  c", ["a", "b", "c"]]);

const shouldHandleEscapedQuotesInsideQuotedStrings = parses([
  '"quoted \\"text\\""',
  ["quoted \\text\\"],
]);

const shouldHandleTrailingSpaces = parses(["a b c   ", ["a", "b", "c"]]);

const shouldHandleLeadingSpaces = parses(["   a b c", ["a", "b", "c"]]);

describe("parseCommandArgs", () => {
  test("should parse simple space-separated arguments", shouldParseSimpleSpaceSeparatedArguments);

  test("should parse quoted arguments with spaces", shouldParseQuotedArgumentsWithSpaces);

  test("should parse single-quoted arguments", shouldParseSingleQuotedArguments);

  test("should parse mixed quote styles", shouldParseMixedQuoteStyles);

  test("should handle empty string", shouldHandleEmptyString);

  test("should handle extra spaces", shouldParseSimpleSpaceSeparatedArguments);

  test("should handle tabs as separators", shouldHandleTabsAsSeparators);

  test("should handle quoted empty string", shouldHandleQuotedEmptyString);

  test(
    "should handle arguments with special characters",
    shouldHandleArgumentsWithSpecialCharacters,
  );

  test("should handle unicode characters", shouldHandleUnicodeCharacters2);

  test("should handle newlines in quoted arguments", shouldHandleNewlinesInQuotedArguments);

  test("should treat unquoted newlines as separators", shouldTreatUnquotedNewlinesAsSeparators);

  test("should collapse mixed unquoted whitespace", shouldCollapseMixedUnquotedWhitespace);

  test(
    "should handle escaped quotes inside quoted strings",
    shouldHandleEscapedQuotesInsideQuotedStrings,
  );

  test("should handle trailing spaces", shouldHandleTrailingSpaces);

  test("should handle leading spaces", shouldHandleLeadingSpaces);
});

const shouldUsePositionalDefaultForEmptyQuoted = () => {
  const template = {
    content: `Review $2. Focus: \${1:-correctness}.`,
    description: "test",
    filePath: "/tmp/review.md",
    name: "review",
    sourceInfo: {
      origin: "top-level",
      path: "/tmp/review.md",
      scope: "temporary",
      source: "local",
    } as const,
  };

  expect(expandPromptTemplate('/review "" src/index.ts', [template])).toBe(
    "Review src/index.ts. Focus: correctness.",
  );
  expect(expandPromptTemplate("/review '' src/index.ts", [template])).toBe(
    "Review src/index.ts. Focus: correctness.",
  );
};

const shouldSplitTemplateArgumentsOnUnquotedNewlines = () => {
  const result = expandPromptTemplate("/arg-test label-2\n\nHere is some description #2.", [
    {
      content: `- arg1: $1\n- rest: \${@:2}`,
      description: "test",
      filePath: "/tmp/arg-test.md",
      name: "arg-test",
      sourceInfo: {
        origin: "top-level",
        path: "/tmp/arg-test.md",
        scope: "temporary",
        source: "local",
      },
    },
  ]);

  expect(result).toBe("- arg1: label-2\n- rest: Here is some description #2.");
};

const shouldSupportTemplateCommandSeparatedFromArgs = () => {
  const result = expandPromptTemplate("/arg-test\nlabel-2", [
    {
      content: "arg1: $1",
      description: "test",
      filePath: "/tmp/arg-test.md",
      name: "arg-test",
      sourceInfo: {
        origin: "top-level",
        path: "/tmp/arg-test.md",
        scope: "temporary",
        source: "local",
      },
    },
  ]);

  expect(result).toBe("arg1: label-2");
};

describe("expandPromptTemplate", () => {
  test(
    "should use positional default for empty quoted argument without shifting later args",
    shouldUsePositionalDefaultForEmptyQuoted,
  );

  test(
    "should split template arguments on unquoted newlines",
    shouldSplitTemplateArgumentsOnUnquotedNewlines,
  );

  test(
    "should support template command separated from args by newline",
    shouldSupportTemplateCommandSeparatedFromArgs,
  );
});

const shouldParseAndSubstituteTogetherCorrectly = () => {
  const input = 'Button "onClick handler" "disabled support"';
  const args = parseCommandArgs(input);
  const template = "Create component $1 with features: $ARGUMENTS";
  const result = substituteArgs(template, args);
  expect(result).toBe(
    "Create component Button with features: Button onClick handler disabled support",
  );
};

const shouldHandleTheExampleFromReadme = () => {
  const input = 'Button "onClick handler" "disabled support"';
  const args = parseCommandArgs(input);
  const template = "Create a React component named $1 with features: $ARGUMENTS";
  const result = substituteArgs(template, args);
  expect(result).toBe(
    "Create a React component named Button with features: Button onClick handler disabled support",
  );
};

const shouldProduceSameResultWithAndArguments = () => {
  const args = parseCommandArgs("feature1 feature2 feature3");
  const template1 = "Implement: $@";
  const template2 = "Implement: $ARGUMENTS";
  expect(substituteArgs(template1, args)).toBe(substituteArgs(template2, args));
};

describe("parseCommandArgs + substituteArgs integration", () => {
  test("should parse and substitute together correctly", shouldParseAndSubstituteTogetherCorrectly);

  test("should handle the example from README", shouldHandleTheExampleFromReadme);

  test(
    "should produce same result with $@ and $ARGUMENTS",
    shouldProduceSameResultWithAndArguments,
  );
});
