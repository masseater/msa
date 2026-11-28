const SCRIPT_IO_VIA_SCRIPT_OUTPUT =
  "scripts・tools のファイル・子プロセス・標準出力は @msa/ai/utils/script-output の runMainWith が渡す ScriptOutput（files・path・processes・print・printError を含む）だけで扱う";

const files: readonly string[] = ["bin/**", "tools/**", "apps/*/bin/**", "libs/*/bin/**"];

const testFiles: readonly string[] = ["**/*.test.*"];

const testProcessOwner = "tools/checks/test-process.ts";

const testProcessModules: readonly string[] = ["effect/process", "@effect/platform-node"];

const globals = ["Bun", "Deno", "console"].map((name) => ({
  message: SCRIPT_IO_VIA_SCRIPT_OUTPUT,
  name,
}));

const scriptIoRules = {
  files,
  globals,
  message: SCRIPT_IO_VIA_SCRIPT_OUTPUT,
  testFiles,
  testProcessModules,
  testProcessOwner,
};

export default scriptIoRules;
