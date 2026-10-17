import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { optionalEnv, windows } from "./environment.ts";

export const daemon =
  optionalEnv("MSA_ENV_DAEMON") ??
  resolve(import.meta.dirname, `../daemon/target/debug/msa-env${windows ? ".exe" : ""}`);
if (!existsSync(daemon)) {
  throw new Error(`Build the daemon first: npm run build:daemon in libs/env (missing ${daemon})`);
}
