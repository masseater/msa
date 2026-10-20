import { Data, Effect } from "effect";
import { dual } from "effect/Function";
import { beforeEach, describe } from "vite-plus/test";

import {
  CodemodeSandbox,
  type CodemodeSandboxBase,
  type CodemodeSandboxBaseOptions,
  type CodemodeTool,
  InlineCodemodeSandbox,
  RemoteCodemodeSandbox,
  loadQuickJSWasm,
  serveCodemodeRemote,
} from "../src/index.ts";

const INTERRUPT_BUDGET = 20_000;
const BACKENDS: Record<string, (options: CodemodeSandboxBaseOptions) => CodemodeSandboxBase> = {
  inline: (options) =>
    new InlineCodemodeSandbox({
      ...options,
      interruptBudget: INTERRUPT_BUDGET,
      wasm: loadQuickJSWasm(),
    }),
  remote: (options) =>
    new RemoteCodemodeSandbox({
      ...options,
      remote: () => ({
        execute: (request, exchange) =>
          serveCodemodeRemote(
            structuredClone(request),
            (messages) =>
              exchange(structuredClone(messages)).then((reply) => structuredClone(reply)),
            { maxInterruptBudget: INTERRUPT_BUDGET, wasm: loadQuickJSWasm() },
          ),
      }),
    }),
  worker: (options) => new CodemodeSandbox(options),
};

const current = { backend: "worker" };
const sandboxes: CodemodeSandboxBase[] = [];

function useBackend(name: string): void {
  current.backend = name;
}

function track(sandbox: CodemodeSandboxBase): void {
  sandboxes.push(sandbox);
}

function newSandbox(options: CodemodeSandboxBaseOptions = {}): CodemodeSandboxBase {
  const create = BACKENDS[current.backend];
  if (create === undefined) throw new Error(`Unknown backend: ${current.backend}`);
  const sandbox = create(options);
  track(sandbox);
  return sandbox;
}

function createSandbox(tools: CodemodeTool[] = []): CodemodeSandboxBase {
  return newSandbox({ timeoutMs: 10_000, tools });
}

function closeSandboxes(): Promise<void> {
  return Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.close())).then(() => undefined);
}

const describeBackends: {
  (body: () => void): (title: string) => void;
  (title: string, body: () => void): void;
} = dual(2, (title: string, body: () => void): void => {
  describe.each(Object.keys(BACKENDS))("%s backend", (name) => {
    beforeEach(() => {
      useBackend(name);
    });
    describe(title, body);
  });
});

const delayed: {
  <A>(value: A): (ms: number) => Promise<A>;
  <A>(ms: number, value: A): Promise<A>;
} = dual(2, <A>(ms: number, value: A): Promise<A> =>
  Effect.runPromise(Effect.sleep(ms).pipe(Effect.as(value))),
);

class ToolAborted extends Data.TaggedError("ToolAborted")<{ readonly message: string }> {}

const rejectOnAbort: {
  (onAbort: () => void): (signal: AbortSignal) => Promise<never>;
  (signal: AbortSignal, onAbort: () => void): Promise<never>;
} = dual(2, (signal: AbortSignal, onAbort: () => void): Promise<never> =>
  Effect.runPromise(
    Effect.callback<never, ToolAborted>((resume) => {
      signal.addEventListener("abort", () => {
        onAbort();
        resume(Effect.fail(new ToolAborted({ message: "aborted" })));
      });
    }),
  ),
);

const echo: CodemodeTool = { execute: (args) => args, name: "echo" };

const PNG = "iVBORw0KGgo=";
const JPEG = "/9j/4A==";
const GIF = "R0lGODlh";
const WEBP = "UklGRgAAAABXRUJQ";

const sandboxSupport = {
  BACKENDS,
  GIF,
  JPEG,
  PNG,
  WEBP,
  closeSandboxes,
  createSandbox,
  delayed,
  describeBackends,
  echo,
  newSandbox,
  rejectOnAbort,
  track,
  useBackend,
};

export default sandboxSupport;
