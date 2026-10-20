import { describe, expect, it } from "vite-plus/test";

import { formatCwdForFooter } from "../src/modes/interactive/components/footer.ts";

const doesNotAbbreviateSiblingPathsThatShare = () => {
  expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
};

const abbreviatesTheHomeDirectoryAndDescendants = () => {
  expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
  expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
};

describe("formatCwdForFooter", () => {
  it(
    "does not abbreviate sibling paths that share the home prefix",
    doesNotAbbreviateSiblingPathsThatShare,
  );

  it("abbreviates the home directory and descendants", abbreviatesTheHomeDirectoryAndDescendants);
});
