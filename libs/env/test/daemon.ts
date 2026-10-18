import { Effect } from "effect";

import { optionalEnv, windows } from "./environment.ts";
import { fileExists, localPath } from "./platform.ts";

export const daemon =
  optionalEnv("MSA_ENV_DAEMON") ??
  localPath.resolve(import.meta.dirname, `../daemon/target/debug/msa-env${windows ? ".exe" : ""}`);
if (!(await Effect.runPromise(fileExists(daemon)))) {
  throw new Error(`Build the daemon first: npm run build:daemon in libs/env (missing ${daemon})`);
}
