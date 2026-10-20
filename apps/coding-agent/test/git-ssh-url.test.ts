import { describe, expect, it } from "vite-plus/test";

import git from "../src/utils/git.ts";

const { parseGitUrl } = git;

const shouldParseHttpsUrl = () => {
  const result = parseGitUrl("https://github.com/user/repo");
  expect(result).toMatchObject({
    host: "github.com",
    path: "user/repo",
    repo: "https://github.com/user/repo",
  });
};

const shouldParseSshUrl = () => {
  const result = parseGitUrl("ssh://git@github.com/user/repo");
  expect(result).toMatchObject({
    host: "github.com",
    path: "user/repo",
    repo: "ssh://git@github.com/user/repo",
  });
};

const shouldParseProtocolUrlWithRef = () => {
  const result = parseGitUrl("https://github.com/user/repo@v1.0.0");
  expect(result).toMatchObject({
    host: "github.com",
    path: "user/repo",
    ref: "v1.0.0",
    repo: "https://github.com/user/repo",
  });
};

const shouldParseGitHostPathWithGit = () => {
  const result = parseGitUrl("git:git@github.com:user/repo");
  expect(result).toMatchObject({
    host: "github.com",
    path: "user/repo",
    repo: "git@github.com:user/repo",
  });
};

const shouldParseHostPathShorthandWithGit = () => {
  const result = parseGitUrl("git:github.com/user/repo");
  expect(result).toMatchObject({
    host: "github.com",
    path: "user/repo",
    repo: "https://github.com/user/repo",
  });
};

const shouldParseShorthandWithRefAndGit = () => {
  const result = parseGitUrl("git:git@github.com:user/repo@v1.0.0");
  expect(result).toMatchObject({
    host: "github.com",
    path: "user/repo",
    ref: "v1.0.0",
    repo: "git@github.com:user/repo",
  });
};

const shouldRejectUnsafeGitInstallPathInputs = () => {
  for (const source of [
    "git:git@evil.example:../../victim/repo",
    "https://evil.example/..%2F..%2Fvictim/repo",
    "https://evil.example/..%2F..%2Fvictim/repo%",
    "git:git@evil.example:/absolute/repo",
    "git:git@evil.example:user\\repo/name",
    "git:git@evil.example:user/repo\0name",
  ]) {
    expect(parseGitUrl(source)).toBeNull();
  }
};

const shouldRejectGitHostPathWithoutGit = () => {
  expect(parseGitUrl("git@github.com:user/repo")).toBeNull();
};

const shouldRejectHostPathShorthandWithoutGit = () => {
  expect(parseGitUrl("github.com/user/repo")).toBeNull();
};

const shouldRejectUserRepoShorthand = () => {
  expect(parseGitUrl("user/repo")).toBeNull();
};

describe("Git URL Parsing", () => {
  describe("protocol URLs (accepted without git: prefix)", () => {
    it("should parse HTTPS URL", shouldParseHttpsUrl);

    it("should parse ssh:// URL", shouldParseSshUrl);

    it("should parse protocol URL with ref", shouldParseProtocolUrlWithRef);
  });

  describe("shorthand URLs (accepted only with git: prefix)", () => {
    it("should parse git@host:path with git: prefix", shouldParseGitHostPathWithGit);

    it("should parse host/path shorthand with git: prefix", shouldParseHostPathShorthandWithGit);

    it("should parse shorthand with ref and git: prefix", shouldParseShorthandWithRefAndGit);
  });

  it("should reject unsafe git install path inputs", shouldRejectUnsafeGitInstallPathInputs);

  describe("unsupported without git: prefix", () => {
    it("should reject git@host:path without git: prefix", shouldRejectGitHostPathWithoutGit);

    it(
      "should reject host/path shorthand without git: prefix",
      shouldRejectHostPathShorthandWithoutGit,
    );

    it("should reject user/repo shorthand", shouldRejectUserRepoShorthand);
  });
});
