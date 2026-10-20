import { describe, expect, test } from "vite-plus/test";

import { type ChangelogEntry, normalizeChangelogLinks } from "../src/utils/changelog.ts";

const entry: ChangelogEntry = {
  content: "",
  major: 0,
  minor: 79,
  patch: 0,
};

const rewritesPackageRelativeChangelogLinksToTag = () => {
  const markdown = [
    "[Project Trust](README.md#project-trust)",
    "[Extensions](docs/extensions.md#project_trust)",
    "[Examples](examples/extensions/)",
    "[Root README](../../README.md#supply-chain-hardening)",
  ].join("\n");

  expect(normalizeChangelogLinks(markdown, entry)).toBe(
    [
      "[Project Trust](https://github.com/masseater/msa/blob/v0.79.0/apps/coding-agent/README.md#project-trust)",
      "[Extensions](https://github.com/masseater/msa/blob/v0.79.0/apps/coding-agent/docs/extensions.md#project_trust)",
      "[Examples](https://github.com/masseater/msa/tree/v0.79.0/apps/coding-agent/examples/extensions/)",
      "[Root README](https://github.com/masseater/msa/blob/v0.79.0/README.md#supply-chain-hardening)",
    ].join("\n"),
  );
};

const pinsFloatingRepositoryLinksAndKeepsOther = () => {
  const markdown = [
    "[Agent README](https://github.com/masseater/msa/blob/main/libs/agent/README.md)",
    "[pi #4163](https://github.com/earendil-works/pi/issues/4163)",
    "[External](https://example.com/docs)",
    "[Local anchor](#settings)",
  ].join("\n");

  expect(normalizeChangelogLinks(markdown, "0.79.0")).toBe(
    [
      "[Agent README](https://github.com/masseater/msa/blob/v0.79.0/libs/agent/README.md)",
      "[pi #4163](https://github.com/earendil-works/pi/issues/4163)",
      "[External](https://example.com/docs)",
      "[Local anchor](#settings)",
    ].join("\n"),
  );
};

describe("normalizeChangelogLinks", () => {
  test(
    "rewrites package-relative changelog links to tag-pinned GitHub source links",
    rewritesPackageRelativeChangelogLinksToTag,
  );

  test(
    "pins floating repository links and keeps other links",
    pinsFloatingRepositoryLinksAndKeepsOther,
  );
});
