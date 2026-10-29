const SCRIPT_IO_VIA_SCRIPT_OUTPUT =
  "scripts・tools のファイル・子プロセス・標準出力は @msa/ai/utils/script-output の runMainWith が渡す ScriptOutput（files・path・processes・print・printError を含む）だけで扱う";

type ImportRules = Readonly<{
  paths: readonly Readonly<{ name: string; message: string }>[];
  patterns: readonly Readonly<{ group: readonly string[]; message: string }>[];
}>;

const files: readonly string[] = [
  "scripts/**",
  "tools/**",
  "apps/*/scripts/**",
  "libs/*/scripts/**",
];

const testFiles: readonly string[] = ["**/*.test.*"];

const testProcessOwner = "tools/checks/test-process.ts";

const testProcessModules: readonly string[] = ["effect/process", "@effect/platform-node"];

const ioModules: readonly string[] = [
  "bun",
  "child_process",
  "cluster",
  "effect/Console",
  "effect/FileSystem",
  "effect/Stdio",
  "effect/Terminal",
  "fs",
  "fs/promises",
  "node:child_process",
  "node:cluster",
  "node:fs",
  "node:fs/promises",
  "node:worker_threads",
  "worker_threads",
];

const ioPackages: readonly string[] = [
  "effect/process",
  "@effect/platform-bun",
  "@effect/platform-node",
  "@effect/platform-node-shared",
];

const ioEffectMembers: readonly string[] = ["Console", "FileSystem", "Stdio", "Terminal"];

const imports = (base: ImportRules, allowed: readonly string[] = []) => ({
  paths: [
    ...base.paths,
    ...ioModules.map((name) => ({ message: SCRIPT_IO_VIA_SCRIPT_OUTPUT, name })),
    {
      importNames: ioEffectMembers,
      message: SCRIPT_IO_VIA_SCRIPT_OUTPUT,
      name: "effect",
    },
  ],
  patterns: [
    ...base.patterns,
    {
      group: ioPackages
        .filter((name) => !allowed.includes(name))
        .flatMap((name) => [name, `${name}/**`]),
      message: SCRIPT_IO_VIA_SCRIPT_OUTPUT,
    },
  ],
});

const globals = ["Bun", "Deno", "console"].map((name) => ({
  message: SCRIPT_IO_VIA_SCRIPT_OUTPUT,
  name,
}));

const properties = ["stdout", "stderr"].map((property) => ({
  message: SCRIPT_IO_VIA_SCRIPT_OUTPUT,
  object: "process",
  property,
}));

const scriptIoRules = {
  files,
  globals,
  imports,
  properties,
  testFiles,
  testProcessModules,
  testProcessOwner,
};

export default scriptIoRules;
