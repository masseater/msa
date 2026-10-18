import {
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@msa/coding-agent";
import { Console, Effect } from "effect";

const createRuntime: CreateAgentSessionRuntimeFactory = ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const services = yield* Effect.promise(() => createAgentSessionServices({ cwd }));
      const session = yield* Effect.promise(() =>
        createAgentSessionFromServices({
          services,
          sessionManager,
          ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
        }),
      );
      return { ...session, services, diagnostics: services.diagnostics };
    }),
  );

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(process.cwd()),
});

let unsubscribe: (() => void) | undefined;

const bindSession = (): Promise<AgentSession> => {
  unsubscribe?.();
  const session = runtime.session;
  return session.bindExtensions({}).then(() => {
    unsubscribe = session.subscribe((event) => {
      if (event.type === "queue_update") {
        Effect.runSync(Console.log("Queued:", event.steering.length + event.followUp.length));
      }
    });
    return session;
  });
};

let session = await bindSession();
const originalSessionFile = session.sessionFile;
Effect.runSync(Console.log("Initial session:", originalSessionFile));

await runtime.newSession();
session = await bindSession();
Effect.runSync(Console.log("After newSession():", session.sessionFile));

if (originalSessionFile !== undefined) {
  await runtime.switchSession(originalSessionFile);
  session = await bindSession();
  Effect.runSync(Console.log("After switchSession():", session.sessionFile));
}

unsubscribe?.();
await runtime.dispose();
