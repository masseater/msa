import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The daemon the tests run: `MSA_ENV_DAEMON` (CI points it at release builds), else the one `cargo build` built in
 * ../daemon.
 */
export const daemon =
  process.env["MSA_ENV_DAEMON"] ??
  resolve(
    import.meta.dirname,
    `../daemon/target/debug/msa-env${process.platform === "win32" ? ".exe" : ""}`,
  );
if (!existsSync(daemon)) {
  throw new Error(`Build the daemon first: npm run build:daemon in libs/env (missing ${daemon})`);
}
