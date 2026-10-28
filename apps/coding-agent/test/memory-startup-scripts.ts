const CREDENTIAL_HELPER = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const [, , file, action] = process.argv;
const input = readFileSync(0, "utf8");
const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
if (action === "store") {
  const entry = JSON.parse(input);
  data[entry.ServerURL] = entry;
  writeFileSync(file, JSON.stringify(data));
} else if (action === "erase") {
  delete data[input.trim()];
  writeFileSync(file, JSON.stringify(data));
} else {
  if (existsSync(process.env.MEMORY_CHECK_LOCK)) {
    process.stderr.write("gpg: decryption failed: No secret key");
    process.exit(2);
  }
  const entry = data[input.trim()];
  if (entry === undefined) {
    process.stdout.write("credentials not found in native keychain");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(entry));
}
`;

const BROWSER = `const url = process.argv.at(-1);
await fetch(url, { redirect: "follow" }).then((response) => response.text());
`;

const chunk = (delta: string, finishReason: string) =>
  `data: {"id":"chatcmpl-memory","object":"chat.completion.chunk","created":0,"model":"memory-model","choices":[{"index":0,"delta":${delta},"finish_reason":${finishReason}}]}\n\n`;

const COMPLETION_STREAM = [
  chunk('{"role":"assistant","content":""}', "null"),
  chunk('{"content":"memory check done"}', "null"),
  chunk("{}", '"stop"'),
  "data: [DONE]\n\n",
].join("");

const memoryToolCallStream = (request: string) => {
  const call = {
    function: { arguments: JSON.stringify({ request }), name: "memory" },
    id: "call_memory",
    index: 0,
    type: "function",
  };
  return [
    chunk(JSON.stringify({ content: null, role: "assistant", tool_calls: [call] }), "null"),
    chunk("{}", '"tool_calls"'),
    "data: [DONE]\n\n",
  ].join("");
};

const RPC_DRIVER = `
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const commands = JSON.parse(process.argv.at(-1));
const child = spawn(process.execPath, ["--import", process.env.MEMORY_CHECK_RESOLVER,
  process.env.MEMORY_CHECK_CLI, "--no-session", "--provider", "memory-check", "--model", "memory-model",
  "--mode", "rpc"], { stdio: ["pipe", "pipe", "pipe"] });
const notices = [];
let buffer = "";
let stderr = "";
let next = 0;
let done = 0;
const send = () => {
  while (commands[next] === "!unlock") {
    rmSync(process.env.MEMORY_CHECK_LOCK, { force: true });
    next += 1;
    done += 1;
  }
  if (next >= commands.length) { child.stdin.end(); return; }
  child.stdin.write(JSON.stringify({ id: "c" + next, type: "prompt", message: commands[next] }) + "\\n");
  next += 1;
};
const finish = () => { done += 1; if (done === next) send(); };
child.stderr.on("data", (data) => { stderr += data; });
child.stdout.on("data", (data) => {
  buffer += data;
  const lines = buffer.split("\\n");
  buffer = lines.pop();
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const notice = event.type === "extension_ui_request" && event.method === "notify"
      ? event.message : event.type === "memory_status" ? event.text : undefined;
    if (notice !== undefined) notices.push(notice);
    const command = commands[next - 1] ?? "";
    if (command.startsWith("/") ? notice !== undefined : event.type === "agent_end") finish();
  }
});
send();
const timer = setTimeout(() => child.kill(), 30000);
child.on("exit", () => {
  clearTimeout(timer);
  console.log(JSON.stringify({ notices, stderr: stderr.slice(-4000) }));
});
`;

const REPLACING_MCP_EXTENSION = `export default function (msa) {
  msa.registerCommand("mcp", { description: "other mcp", handler: async () => {} });
}
`;

const RUN_CLI = `import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["--import", process.env.MEMORY_CHECK_RESOLVER,
  process.env.MEMORY_CHECK_CLI, ...JSON.parse(process.argv.at(-1))], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
console.log(JSON.stringify({ code: result.status, stderr: result.stderr, stdout: result.stdout }));`;

const memoryStartupScripts = {
  BROWSER,
  COMPLETION_STREAM,
  CREDENTIAL_HELPER,
  REPLACING_MCP_EXTENSION,
  RPC_DRIVER,
  RUN_CLI,
  memoryToolCallStream,
};

export default memoryStartupScripts;
