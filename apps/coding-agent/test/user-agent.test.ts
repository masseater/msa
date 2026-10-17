import { describe, expect, it } from "vite-plus/test";

import { getMsaUserAgent } from "../src/utils/user-agent.ts";

describe("getMsaUserAgent", () => {
  it("formats the user agent expected by pi.dev", () => {
    const runtime = process.versions.bun
      ? `bun/${process.versions.bun}`
      : `node/${process.version}`;
    const userAgent = getMsaUserAgent("1.2.3");

    expect(userAgent).toBe(`pi/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
    expect(userAgent).toMatch(/^pi\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
  });
});
