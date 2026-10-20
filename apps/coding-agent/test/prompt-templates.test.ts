import { describe, expect, test } from "vite-plus/test";

import promptTemplates from "../src/core/prompt-templates.ts";

const { substituteArgs } = promptTemplates;

const shouldReplaceArgumentsWithAllArgsJoined = () => {
  expect(substituteArgs("Test: $ARGUMENTS", ["a", "b", "c"])).toBe("Test: a b c");
};

const shouldReplaceWithAllArgsJoined = () => {
  expect(substituteArgs("Test: $@", ["a", "b", "c"])).toBe("Test: a b c");
};

const shouldReplaceAndArgumentsIdentically = () => {
  const args = ["foo", "bar", "baz"];
  expect(substituteArgs("Test: $@", args)).toBe(substituteArgs("Test: $ARGUMENTS", args));
};

const shouldNotRecursivelySubstitutePatternsInArgument = () => {
  expect(substituteArgs("$ARGUMENTS", ["$1", "$ARGUMENTS"])).toBe("$1 $ARGUMENTS");
  expect(substituteArgs("$@", ["$100", "$1"])).toBe("$100 $1");
  expect(substituteArgs("$ARGUMENTS", ["$100", "$1"])).toBe("$100 $1");
};

const shouldSupportMixed12AndArguments = () => {
  expect(substituteArgs("$1: $ARGUMENTS", ["prefix", "a", "b"])).toBe("prefix: prefix a b");
};

const shouldSupportMixed12And = () => {
  expect(substituteArgs("$1: $@", ["prefix", "a", "b"])).toBe("prefix: prefix a b");
};

const shouldHandleEmptyArgumentsArrayWithArguments = () => {
  expect(substituteArgs("Test: $ARGUMENTS", [])).toBe("Test: ");
};

const shouldHandleEmptyArgumentsArrayWith = () => {
  expect(substituteArgs("Test: $@", [])).toBe("Test: ");
};

const shouldHandleEmptyArgumentsArrayWith1 = () => {
  expect(substituteArgs("Test: $1", [])).toBe("Test: ");
};

const shouldHandleMultipleOccurrencesOfArguments = () => {
  expect(substituteArgs("$ARGUMENTS and $ARGUMENTS", ["a", "b"])).toBe("a b and a b");
};

const shouldHandleMultipleOccurrencesOf = () => {
  expect(substituteArgs("$@ and $@", ["a", "b"])).toBe("a b and a b");
};

const shouldHandleMixedOccurrencesOfAndArguments = () => {
  expect(substituteArgs("$@ and $ARGUMENTS", ["a", "b"])).toBe("a b and a b");
};

const shouldHandleSpecialCharactersInArguments = () => {
  expect(substituteArgs("$1 $2: $ARGUMENTS", ["arg100", "@user"])).toBe(
    "arg100 @user: arg100 @user",
  );
};

const shouldHandleOutOfRangeNumberedPlaceholders = () => {
  expect(substituteArgs("$1 $2 $3 $4 $5", ["a", "b"])).toBe("a b   ");
};

const shouldHandleUnicodeCharacters = () => {
  expect(substituteArgs("$ARGUMENTS", ["日本語", "🎉", "café"])).toBe("日本語 🎉 café");
};

const shouldPreserveNewlinesAndTabsInArgument = () => {
  expect(substituteArgs("$1 $2", ["line1\nline2", "tab\tthere"])).toBe("line1\nline2 tab\tthere");
};

const shouldHandleConsecutiveDollarPatterns = () => {
  expect(substituteArgs("$1$2", ["a", "b"])).toBe("ab");
};

const shouldHandleQuotedArgumentsWithSpaces = () => {
  expect(substituteArgs("$ARGUMENTS", ["first arg", "second arg"])).toBe("first arg second arg");
};

const shouldHandleSingleArgumentWithArguments = () => {
  expect(substituteArgs("Test: $ARGUMENTS", ["only"])).toBe("Test: only");
};

const shouldHandleSingleArgumentWith = () => {
  expect(substituteArgs("Test: $@", ["only"])).toBe("Test: only");
};

const shouldHandle0ZeroIndex = () => {
  expect(substituteArgs("$0", ["a", "b"])).toBe("");
};

const shouldHandleDecimalNumberInPatternOnly = () => {
  expect(substituteArgs("$1.5", ["a"])).toBe("a.5");
};

const shouldHandleArgumentsAsPartOfWord = () => {
  expect(substituteArgs("pre$ARGUMENTS", ["a", "b"])).toBe("prea b");
};

const shouldHandleAsPartOfWord = () => {
  expect(substituteArgs("pre$@", ["a", "b"])).toBe("prea b");
};

const shouldHandleEmptyArgumentsInMiddleOf = () => {
  expect(substituteArgs("$ARGUMENTS", ["a", "", "c"])).toBe("a  c");
};

const shouldHandleTrailingAndLeadingSpacesIn = () => {
  expect(substituteArgs("$ARGUMENTS", ["  leading  ", "trailing  "])).toBe(
    "  leading   trailing  ",
  );
};

const shouldHandleArgumentContainingPatternPartially = () => {
  expect(substituteArgs("Prefix $ARGUMENTS suffix", ["ARGUMENTS"])).toBe("Prefix ARGUMENTS suffix");
};

const shouldHandleNonMatchingPatterns = () => {
  expect(substituteArgs("$A $$ $ $ARGS", ["a"])).toBe("$A $$ $ $ARGS");
};

const shouldHandleCaseVariationsCaseSensitive = () => {
  expect(substituteArgs("$arguments $Arguments $ARGUMENTS", ["a", "b"])).toBe(
    "$arguments $Arguments a b",
  );
};

const shouldHandleBothSyntaxesInSameCommand = () => {
  const args = ["x", "y", "z"];
  const result1 = substituteArgs("$@ and $ARGUMENTS", args);
  const result2 = substituteArgs("$ARGUMENTS and $@", args);
  expect(result1).toBe(result2);
  expect(result1).toBe("x y z and x y z");
};

const shouldHandleVeryLongArgumentLists = () => {
  const args = Array.from({ length: 100 }, (_, i) => `arg${i}`);
  const result = substituteArgs("$ARGUMENTS", args);
  expect(result).toBe(args.join(" "));
};

const shouldHandleNumberedPlaceholdersWithSingleDigit = () => {
  expect(substituteArgs("$1 $2 $3", ["a", "b", "c"])).toBe("a b c");
};

const shouldHandleNumberedPlaceholdersWithMultipleDigits = () => {
  const args = Array.from({ length: 15 }, (_, i) => `val${i}`);
  expect(substituteArgs("$10 $12 $15", args)).toBe("val9 val11 val14");
};

const shouldHandleEscapedDollarSignsLiteralBackslash = () => {
  expect(substituteArgs("Price: \\$100", [])).toBe("Price: \\");
};

const shouldHandleMixedNumberedAndWildcardPlaceholders = () => {
  expect(substituteArgs("$1: $@ ($ARGUMENTS)", ["first", "second", "third"])).toBe(
    "first: first second third (first second third)",
  );
};

const shouldHandleCommandWithNoPlaceholders = () => {
  expect(substituteArgs("Just plain text", ["a", "b"])).toBe("Just plain text");
};

const shouldHandleCommandWithOnlyPlaceholders = () => {
  expect(substituteArgs("$1 $2 $@", ["a", "b", "c"])).toBe("a b a b c");
};

const substituteArgsCases: ReadonlyArray<readonly [string, () => void]> = [
  ["should replace $ARGUMENTS with all args joined", shouldReplaceArgumentsWithAllArgsJoined],
  ["should replace $@ with all args joined", shouldReplaceWithAllArgsJoined],
  ["should replace $@ and $ARGUMENTS identically", shouldReplaceAndArgumentsIdentically],
  [
    "should NOT recursively substitute patterns in argument values",
    shouldNotRecursivelySubstitutePatternsInArgument,
  ],
  ["should support mixed $1, $2, and $ARGUMENTS", shouldSupportMixed12AndArguments],
  ["should support mixed $1, $2, and $@", shouldSupportMixed12And],
  [
    "should handle empty arguments array with $ARGUMENTS",
    shouldHandleEmptyArgumentsArrayWithArguments,
  ],
  ["should handle empty arguments array with $@", shouldHandleEmptyArgumentsArrayWith],
  ["should handle empty arguments array with $1", shouldHandleEmptyArgumentsArrayWith1],
  ["should handle multiple occurrences of $ARGUMENTS", shouldHandleMultipleOccurrencesOfArguments],
  ["should handle multiple occurrences of $@", shouldHandleMultipleOccurrencesOf],
  [
    "should handle mixed occurrences of $@ and $ARGUMENTS",
    shouldHandleMixedOccurrencesOfAndArguments,
  ],
  ["should handle special characters in arguments", shouldHandleSpecialCharactersInArguments],
  ["should handle out-of-range numbered placeholders", shouldHandleOutOfRangeNumberedPlaceholders],
  ["should handle unicode characters", shouldHandleUnicodeCharacters],
  ["should preserve newlines and tabs in argument values", shouldPreserveNewlinesAndTabsInArgument],
  ["should handle consecutive dollar patterns", shouldHandleConsecutiveDollarPatterns],
  ["should handle quoted arguments with spaces", shouldHandleQuotedArgumentsWithSpaces],
  ["should handle single argument with $ARGUMENTS", shouldHandleSingleArgumentWithArguments],
  ["should handle single argument with $@", shouldHandleSingleArgumentWith],
  ["should handle $0 (zero index)", shouldHandle0ZeroIndex],
  [
    "should handle decimal number in pattern (only integer part matches)",
    shouldHandleDecimalNumberInPatternOnly,
  ],
  ["should handle $ARGUMENTS as part of word", shouldHandleArgumentsAsPartOfWord],
  ["should handle $@ as part of word", shouldHandleAsPartOfWord],
  ["should handle empty arguments in middle of list", shouldHandleEmptyArgumentsInMiddleOf],
  [
    "should handle trailing and leading spaces in arguments",
    shouldHandleTrailingAndLeadingSpacesIn,
  ],
  [
    "should handle argument containing pattern partially",
    shouldHandleArgumentContainingPatternPartially,
  ],
  ["should handle non-matching patterns", shouldHandleNonMatchingPatterns],
  ["should handle case variations (case-sensitive)", shouldHandleCaseVariationsCaseSensitive],
  [
    "should handle both syntaxes in same command with same result",
    shouldHandleBothSyntaxesInSameCommand,
  ],
  ["should handle very long argument lists", shouldHandleVeryLongArgumentLists],
  [
    "should handle numbered placeholders with single digit",
    shouldHandleNumberedPlaceholdersWithSingleDigit,
  ],
  [
    "should handle numbered placeholders with multiple digits",
    shouldHandleNumberedPlaceholdersWithMultipleDigits,
  ],
  [
    "should handle escaped dollar signs (literal backslash preserved)",
    shouldHandleEscapedDollarSignsLiteralBackslash,
  ],
  [
    "should handle mixed numbered and wildcard placeholders",
    shouldHandleMixedNumberedAndWildcardPlaceholders,
  ],
  ["should handle command with no placeholders", shouldHandleCommandWithNoPlaceholders],
  ["should handle command with only placeholders", shouldHandleCommandWithOnlyPlaceholders],
];

describe("substituteArgs", () => {
  for (const [name, run] of substituteArgsCases) test(name, run);
});
