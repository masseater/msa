import { describe, expect, it } from "vite-plus/test";

import { parseFrontmatter, stripFrontmatter } from "../src/utils/frontmatter.ts";

const parsesKeysStripsQuotesAndReturnsBody = () => {
  const input =
    "---\nname: \"skill-name\"\ndescription: 'A desc'\nfoo-bar: value\n---\n\nBody text";
  const { frontmatter, body } = parseFrontmatter<Record<string, string>>(input);
  expect(frontmatter["name"]).toBe("skill-name");
  expect(frontmatter["description"]).toBe("A desc");
  expect(frontmatter["foo-bar"]).toBe("value");
  expect(body).toBe("Body text");
};

const normalizesNewlinesAndHandlesCrlf = () => {
  const input = "---\r\nname: test\r\n---\r\nLine one\r\nLine two";
  const { body } = parseFrontmatter<Record<string, string>>(input);
  expect(body).toBe("Line one\nLine two");
};

const throwsOnInvalidYamlFrontmatter = () => {
  const input = "---\nfoo: [bar\n---\nBody";
  expect(() => parseFrontmatter<Record<string, string>>(input)).toThrow(/at line 1, column 10/u);
};

const parsesMultilineYamlSyntax = () => {
  const input = "---\ndescription: |\n  Line one\n  Line two\n---\n\nBody";
  const { frontmatter, body } = parseFrontmatter<Record<string, string>>(input);
  expect(frontmatter["description"]).toBe("Line one\nLine two\n");
  expect(body).toBe("Body");
};

const returnsOriginalContentWhenFrontmatterIsMissing = () => {
  const noFrontmatter = "Just text\nsecond line";
  const missingEnd = "---\nname: test\nBody without terminator";
  const resultNoFrontmatter = parseFrontmatter<Record<string, string>>(noFrontmatter);
  const resultMissingEnd = parseFrontmatter<Record<string, string>>(missingEnd);
  expect(resultNoFrontmatter.body).toBe("Just text\nsecond line");
  expect(resultMissingEnd.body).toBe(
    "---\nname: test\nBody without terminator".replace(/\r\n/gu, "\n").replace(/\r/gu, "\n"),
  );
};

const returnsEmptyObjectForEmptyOrComment = () => {
  const input = "---\n# just a comment\n---\nBody";
  const { frontmatter } = parseFrontmatter(input);
  expect(frontmatter).toEqual({});
};

describe("parseFrontmatter", () => {
  it("parses keys, strips quotes, and returns body", parsesKeysStripsQuotesAndReturnsBody);

  it("normalizes newlines and handles CRLF", normalizesNewlinesAndHandlesCrlf);

  it("throws on invalid YAML frontmatter", throwsOnInvalidYamlFrontmatter);

  it("parses | multiline yaml syntax", parsesMultilineYamlSyntax);

  it(
    "returns original content when frontmatter is missing or unterminated",
    returnsOriginalContentWhenFrontmatterIsMissing,
  );

  it(
    "returns empty object for empty or comment-only frontmatter",
    returnsEmptyObjectForEmptyOrComment,
  );
});

const removesFrontmatterAndTrimsBody = () => {
  const input = "---\nkey: value\n---\n\nBody\n";
  expect(stripFrontmatter(input)).toBe("Body");
};

const returnsBodyWhenNoFrontmatterPresent = () => {
  const input = "\n  No frontmatter body  \n";
  expect(stripFrontmatter(input)).toBe("\n  No frontmatter body  \n");
};

describe("stripFrontmatter", () => {
  it("removes frontmatter and trims body", removesFrontmatterAndTrimsBody);

  it("returns body when no frontmatter present", returnsBodyWhenNoFrontmatterPresent);
});
