import type { UserConfig } from "vite-plus";

const workspace = (pattern: string) => ({ base: "workspace" as const, pattern });

const libSources = [
  "libs/*/package.json",
  "libs/*/src/**",
  "libs/*/tsconfig.build.json",
  "libs/*/tsconfig.json",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
].map(workspace);

const libBuild = {
  cache: { input: libSources, output: ["dist/**"] },
  command: "tsc -p tsconfig.build.json",
};

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

interface TestedPackage {
  readonly dirs: ReadonlyArray<string>;
  readonly files?: ReadonlyArray<string>;
  readonly needs: ReadonlyArray<TestedName>;
  readonly project?: string;
}

type TestedName =
  | "agent"
  | "ai"
  | "chord"
  | "codemode"
  | "coding-agent"
  | "durable"
  | "env"
  | "evals"
  | "mcp"
  | "telemetry"
  | "testing"
  | "tools"
  | "tui";

const testedPackages: Readonly<Record<TestedName, TestedPackage>> = {
  agent: { dirs: ["libs/agent"], needs: ["ai", "testing"], project: "@msa/agent-core" },
  ai: { dirs: ["libs/ai"], needs: ["telemetry", "testing"], project: "@msa/ai" },
  chord: { dirs: ["libs/chord"], needs: ["testing"], project: "@msa/chord" },
  codemode: { dirs: ["libs/codemode"], needs: ["testing"], project: "@msa/codemode" },
  "coding-agent": {
    dirs: ["apps/coding-agent", "scripts", "tools/class-seal"],
    files: ["tools/checks/class-extends-cases.ts", "tools/oxlint/class-factories.ts"],
    needs: ["agent", "ai", "chord", "codemode", "mcp", "telemetry", "testing", "tui"],
    project: "@msa/coding-agent",
  },
  durable: {
    dirs: ["libs/durable"],
    needs: ["ai", "chord", "codemode", "testing"],
    project: "@msa/durable*",
  },
  env: { dirs: ["libs/env"], needs: ["chord", "durable", "testing"], project: "@msa/env" },
  evals: {
    dirs: ["apps/evals"],
    needs: ["ai", "coding-agent", "testing", "tui"],
    project: "@msa/evals",
  },
  mcp: { dirs: ["libs/mcp"], needs: ["chord", "testing"], project: "@msa/mcp" },
  telemetry: { dirs: ["libs/telemetry"], needs: ["testing"], project: "@msa/telemetry" },
  testing: { dirs: ["libs/testing"], needs: [], project: "@msa/testing" },
  tools: { dirs: ["**"], needs: [], project: "tools" },
  tui: { dirs: ["libs/tui"], needs: ["chord", "testing"] },
};

const closureOf = (name: TestedName, seen: ReadonlySet<TestedName> = new Set()): Set<TestedName> =>
  testedPackages[name].needs.reduce(
    (found, need) => (found.has(need) ? found : closureOf(need, found)),
    new Set([...seen, name]),
  );

const testScratch = [
  ".git",
  "**/node_modules",
  "**/dist",
  "lint-probe",
  "apps/coding-agent/.class-seal-probe",
  "libs/env/daemon/target",
];

const sharedInputs = [
  "effect-rules.config.ts",
  "lint.config.ts",
  "local-time-rules.config.ts",
  "package.json",
  "patches/**",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "run.config.ts",
  "test.sh",
  "tsconfig.base.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.shared.ts",
];

const packageInputs = (tested: TestedPackage): ReadonlyArray<string> => [
  ...tested.dirs.map((dir) => (dir === "**" ? dir : `${dir}/**`)),
  ...(tested.files ?? []),
];

const inputsOf = (name: TestedName): string[] => [
  ...sharedInputs,
  ...Array.from(closureOf(name), (tested) => packageInputs(testedPackages[tested])).flat(),
  ...testScratch.map((dir) => `!${dir}/**`),
  "!libs/ai/src/providers/data/.manifest.json",
];

const testTaskOf = (name: TestedName, command: string, cwd?: string) => ({
  cache: { ...testCache, input: inputsOf(name) },
  command,
  ...(cwd === undefined ? {} : { cwd }),
});

const vitestProjectTasks = Object.fromEntries(
  Object.entries(testedPackages).flatMap(([name, tested]) =>
    tested.project === undefined
      ? []
      : [
          [
            `test:${name}`,
            testTaskOf(name as TestedName, `vp test run --project '${tested.project}'`),
          ],
        ],
  ),
);

const run: NonNullable<UserConfig["run"]> = {
  tasks: {
    "actions-lint": {
      cache: {
        env: ["CLAUDE_CODE_REMOTE"],
        untrackedEnv: [
          "GH_TOKEN",
          "HTTPS_PROXY",
          "https_proxy",
          "NO_PROXY",
          "no_proxy",
          "SSL_CERT_FILE",
        ],
      },
      command:
        'uvx --from actionlint-py@1.7.12.25 actionlint && uvx zizmor@1.30.1 $(test -n "$CLAUDE_CODE_REMOTE" && echo --no-online-audits) .github && ast-grep scan --rule .github/rules/no-full-history-checkout.yml .github/workflows',
    },
    audit: {
      cache: false,
      command: "vp pm audit",
    },
    "build-binaries": {
      cache: false,
      command: "node tools/build-binaries.ts",
    },
    check: "vp check",
    checks: {
      command: [],
      dependsOn: [
        "check",
        "syncpack",
        "actions-lint",
        "code-rules",
        "lockfile-policy",
        "test:mcp-conformance",
        "fallow-all",
        "audit",
      ],
    },
    "code-rules": {
      command:
        "ast-grep scan --rule tools/rules/no-sync-run-of-async-fs.yml apps libs tools .msa && ast-grep scan --rule tools/rules/no-unawaited-test-cleanup.yml apps && ast-grep scan --rule tools/rules/no-counted-wait-loop.yml apps libs && ast-grep scan --rule tools/rules/no-untracked-orchestrator-launch.yml apps && ast-grep scan --rule tools/rules/no-fork-in-run-sync.yml apps libs tools .msa && ast-grep scan --rule tools/rules/no-html-outside-html-document.yml apps libs scripts tools .msa && ast-grep scan --rule tools/rules/scripts-start-through-run-main.yml apps libs scripts tools",
    },
    "daemon-build": {
      cache: {
        input: [
          "libs/env/package.json",
          "libs/env/daemon/build.rs",
          "libs/env/daemon/Cargo.lock",
          "libs/env/daemon/Cargo.toml",
          "libs/env/daemon/rust-toolchain.toml",
          "libs/env/daemon/src/**",
        ],
        output: [
          "libs/env/daemon/target/debug/msa-env",
          "libs/env/daemon/target/debug/msa-env.exe",
        ],
        untrackedEnv: ["CARGO_*", "RUSTUP_*"],
      },
      command: "cargo build --locked",
      cwd: "libs/env/daemon",
    },
    fallow: {
      cache: fallowCache,
      command:
        "fallow --skip dupes --fail-on-issues --quiet --format compact && fallow dead-code --no-production --fail-on-issues --quiet --format compact && fallow dead-code --no-production --quiet --format json | jq -e '[.prop_drilling_chains, .thin_wrappers, .duplicate_prop_shapes] | all(length == 0)' > /dev/null && fallow dupes --fail-on-issues --quiet --format compact && fallow security --fail-on-issues --quiet",
    },
    "fallow-all": "vp run -r fallow",
    gitleaks: {
      cache: false,
      command:
        'go run github.com/zricethezav/gitleaks/v8@v8.30.1 git --redact --no-banner --log-opts="$(git rev-parse -q --verify "$GITLEAKS_BASE" || echo origin/main)..HEAD"',
    },
    "install-local": {
      cache: false,
      command: "node tools/local-install.ts",
    },
    "lockfile-policy":
      "git ls-files -- ':(glob)**/package-lock.json' ':(glob)**/npm-shrinkwrap.json' ':(glob)**/yarn.lock' ':(glob)**/bun.lock' ':(glob)**/bun.lockb' ':(glob)**/deno.lock' | awk '{ print \"pnpm-lock.yaml 以外の lock がコミットされている: \" $0; found = 1 } END { exit found }'",
    "render-homebrew-formula": {
      cache: false,
      command: "node tools/render-homebrew-formula.ts",
    },
    "smoke-binary-decide": {
      cache: false,
      command: "node tools/smoke-binary-decide.ts",
    },
    "smoke-binary-export": {
      cache: false,
      command: "node tools/smoke-binary-export.ts",
    },
    syncpack: "syncpack lint",
    test: {
      command: [],
      dependsOn: [...Object.keys(vitestProjectTasks), "test:tui"],
    },
    ...vitestProjectTasks,
    "test-all": {
      cache: false,
      command: "bash test.sh",
      dependsOn: ["test-deps"],
    },
    "test-deps": {
      command: [],
      dependsOn: ["build", "daemon-build"],
    },
    "test:mcp-conformance": {
      cache: { output: [] },
      command:
        "node --import ./apps/coding-agent/src/experimental/source-resolver.ts apps/coding-agent/test/mcp-conformance/run.ts",
    },
    "test:tui": testTaskOf(
      "tui",
      "node --test --test-shard=${MSA_TEST_SHARD:-1/1} --conditions=source --test-reporter=dot --test-reporter-destination=stdout test/*.test.ts",
      "libs/tui",
    ),
    verify: {
      command: [],
      dependsOn: ["checks", "test-all"],
    },
  },
};

const runConfig = { libBuild, libSources, run, workspace };

export default runConfig;
