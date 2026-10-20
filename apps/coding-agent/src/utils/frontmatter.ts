import { parse } from "yaml";

import text from "./text.ts";

const { stripBom } = text;

type ParsedFrontmatter<T extends Record<string, unknown>> = {
  frontmatter: T;
  body: string;
};

const normalizeNewlines = (value: string): string =>
  value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");

const extractFrontmatter = (content: string): { yamlString: string | null; body: string } => {
  const normalized = normalizeNewlines(stripBom(content));

  if (!normalized.startsWith("---")) {
    return { body: normalized, yamlString: null };
  }

  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { body: normalized, yamlString: null };
  }

  return {
    body: normalized.slice(endIndex + 4).trim(),
    yamlString: normalized.slice(4, endIndex),
  };
};

const parseFrontmatter = <T extends Record<string, unknown> = Record<string, unknown>>(
  content: string,
): ParsedFrontmatter<T> => {
  const { yamlString, body } = extractFrontmatter(content);
  if (yamlString === null || yamlString === "") {
    return { body, frontmatter: {} as T };
  }
  const parsed = parse(yamlString);
  return { body, frontmatter: (parsed ?? {}) as T };
};

const stripFrontmatter = (content: string): string => parseFrontmatter(content).body;

const frontmatter = {
  parseFrontmatter,
  stripFrontmatter,
};

export default frontmatter;
