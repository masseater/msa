import { describe, expect, it } from "vite-plus/test";

import git from "../src/utils/git.ts";

const { parseGitUrl } = git;

const parsedCases = [
  {
    expected: { host: "github.com", path: "user/repo", repo: "https://github.com/user/repo" },
    group: "protocol URLs (accepted without git: prefix)",
    name: "should parse HTTPS URL",
    source: "https://github.com/user/repo",
  },
  {
    expected: {
      host: "github.com",
      path: "user/repo",
      repo: "ssh://git@github.com/user/repo",
    },
    group: "protocol URLs (accepted without git: prefix)",
    name: "should parse ssh:// URL",
    source: "ssh://git@github.com/user/repo",
  },
  {
    expected: {
      host: "github.com",
      path: "user/repo",
      ref: "v1.0.0",
      repo: "https://github.com/user/repo",
    },
    group: "protocol URLs (accepted without git: prefix)",
    name: "should parse protocol URL with ref",
    source: "https://github.com/user/repo@v1.0.0",
  },
  {
    expected: { host: "github.com", path: "user/repo", repo: "git@github.com:user/repo" },
    group: "shorthand URLs (accepted only with git: prefix)",
    name: "should parse git@host:path with git: prefix",
    source: "git:git@github.com:user/repo",
  },
  {
    expected: { host: "github.com", path: "user/repo", repo: "https://github.com/user/repo" },
    group: "shorthand URLs (accepted only with git: prefix)",
    name: "should parse host/path shorthand with git: prefix",
    source: "git:github.com/user/repo",
  },
  {
    expected: {
      host: "github.com",
      path: "user/repo",
      ref: "v1.0.0",
      repo: "git@github.com:user/repo",
    },
    group: "shorthand URLs (accepted only with git: prefix)",
    name: "should parse shorthand with ref and git: prefix",
    source: "git:git@github.com:user/repo@v1.0.0",
  },
];

const unsafeSources = [
  "git:git@evil.example:../../victim/repo",
  "https://evil.example/..%2F..%2Fvictim/repo",
  "https://evil.example/..%2F..%2Fvictim/repo%",
  "git:git@evil.example:/absolute/repo",
  "git:git@evil.example:user\\repo/name",
  "git:git@evil.example:user/repo\0name",
];

const rejectedCases = [
  { name: "should reject git@host:path without git: prefix", source: "git@github.com:user/repo" },
  {
    name: "should reject host/path shorthand without git: prefix",
    source: "github.com/user/repo",
  },
  { name: "should reject user/repo shorthand", source: "user/repo" },
];

describe("Git URL Parsing", () => {
  it.each(parsedCases)("$group $name", ({ expected, source }) => {
    expect(parseGitUrl(source)).toMatchObject(expected);
  });

  it.each(unsafeSources)("should reject unsafe git install path input %j", (source) => {
    expect(parseGitUrl(source)).toBeNull();
  });

  it.each(rejectedCases)("unsupported without git: prefix $name", ({ source }) => {
    expect(parseGitUrl(source)).toBeNull();
  });
});
