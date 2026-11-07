const fallowCache = {
  input: [
    { auto: true },
    "!**/.fallow/**",
    "!node_modules/.pnpm/@fallow-cli+*/**/.fallow-verified",
  ],
  output: [],
};

const testCache = {
  env: ["MSA_LOCAL_LLM_TESTS", "MSA_TEST_SHARD", "NEO4J_URI", "NEO4J_USERNAME"],
  output: [],
  untrackedEnv: [
    "COMSPEC",
    "FORCE_COLOR",
    "GIT_*",
    "NEO4J_PASSWORD",
    "NO_COLOR",
    "NODE_EXTRA_CA_CERTS",
    "NPM_CONFIG_*",
    "PATHEXT",
    "PWD",
    "TMPDIR",
    "WINDIR",
    "XDG_*",
  ],
};

const taskCaches = { fallowCache, testCache };

export default taskCaches;
