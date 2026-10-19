import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
} from "@msa/coding-agent";
import { Console, Effect } from "effect";

const cwd = process.cwd();

const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir: getAgentDir(),
  extensionFactories: [
    createCodemodeExtension({ mode: "on" }),
    createToolSearchExtension(),

    createMcpExtension(),
  ],
});
await resourceLoader.reload();

const settingsManager = SettingsManager.create(cwd);

settingsManager.applyOverrides({ defaultTools: ["+codemode", "+tool_search"] });

const { session } = await createAgentSession({
  resourceLoader,
  settingsManager,
  sessionManager: SessionManager.inMemory(),
});

try {
  await session.bindExtensions({});
  Effect.runSync(Console.log("Active tools:", session.getActiveToolNames().join(", ")));
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });
  await session.prompt(
    "Use codemode to count the TypeScript files in src/ and list the three largest.",
  );
  Effect.runSync(Console.log());
} finally {
  session.dispose();
}
