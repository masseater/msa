import environment from "./environment.ts";
import platform from "./platform.ts";

const { optionalEnv, windows } = environment;
const { localPath } = platform;

const daemon =
  optionalEnv("MSA_ENV_DAEMON") ??
  localPath.resolve(import.meta.dirname, `../daemon/target/debug/msa-env${windows ? ".exe" : ""}`);

export default daemon;
