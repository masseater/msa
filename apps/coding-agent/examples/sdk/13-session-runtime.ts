import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Console, Effect } from "effect";

const {
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
} = codingAgent;

const createRuntime: codingAgentTypes.CreateAgentSessionRuntimeFactory = ({
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
      return { ...session, diagnostics: services.diagnostics, services };
    }),
  );

void Effect.runPromise(
  Effect.gen(function* () {
    const runtime = yield* Effect.promise(() =>
      createAgentSessionRuntime(createRuntime, {
        agentDir: getAgentDir(),
        cwd: process.cwd(),
        sessionManager: SessionManager.create(process.cwd()),
      }),
    );

    let unsubscribe: (() => void) | undefined;

    const bindSession = (): Promise<codingAgentTypes.AgentSession> => {
      unsubscribe?.();
      const session = runtime.session;
      return session.extensions.binding.bindExtensions({}).then(() => {
        unsubscribe = session.subscribe((event) => {
          if (event.type === "queue_update") {
            process.stdout.write(`Queued: ${event.steering.length + event.followUp.length}\n`);
          }
        });
        return session;
      });
    };

    let session = yield* Effect.promise(() => bindSession());
    const originalSessionFile = session.sessionFile;
    yield* Console.log("Initial session:", originalSessionFile);

    yield* Effect.promise(() => runtime.newSession());
    session = yield* Effect.promise(() => bindSession());
    yield* Console.log("After newSession():", session.sessionFile);

    if (originalSessionFile !== undefined) {
      yield* Effect.promise(() => runtime.switchSession(originalSessionFile));
      session = yield* Effect.promise(() => bindSession());
      yield* Console.log("After switchSession():", session.sessionFile);
    }

    unsubscribe?.();
    yield* Effect.promise(() => runtime.dispose());
  }),
);
