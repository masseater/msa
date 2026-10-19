import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";

import { afterAll } from "vite-plus/test";

delete process.env["MSA_CODING_AGENT_DIR"];

if (homedir() === userInfo().homedir) {
  const home = mkdtempSync(join(tmpdir(), "msa-test-home-"));
  process.env["HOME"] = home;
  process.env["USERPROFILE"] = home;
  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });
}
