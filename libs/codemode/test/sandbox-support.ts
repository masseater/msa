import { Data, Effect } from "effect";
import { dual } from "effect/Function";
import { beforeEach, describe } from "vite-plus/test";

import {
  CodemodeSandbox,
  type CodemodeSandboxBase,
  type CodemodeSandboxBaseOptions,
  type CodemodeTool,
  InlineCodemodeSandbox,
  loadQuickJSWasm,
  RemoteCodemodeSandbox,
  serveCodemodeRemote,
} from "../src/index.ts";

const INTERRUPT_BUDGET = 20_000;
export const BACKENDS: Record<
  string,
  (options: CodemodeSandboxBaseOptions) => CodemodeSandboxBase
> = {
  worker: (options) => new CodemodeSandbox(options),
  inline: (options) =>
    new InlineCodemodeSandbox({
      ...options,
      wasm: loadQuickJSWasm(),
      interruptBudget: INTERRUPT_BUDGET,
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
            { wasm: loadQuickJSWasm(), maxInterruptBudget: INTERRUPT_BUDGET },
          ),
      }),
    }),
};

const current = { backend: "worker" };
const sandboxes: CodemodeSandboxBase[] = [];

export function useBackend(name: string): void {
  current.backend = name;
}

export function track(sandbox: CodemodeSandboxBase): void {
  sandboxes.push(sandbox);
}

export function newSandbox(options: CodemodeSandboxBaseOptions = {}): CodemodeSandboxBase {
  const create = BACKENDS[current.backend];
  if (create === undefined) throw new Error(`Unknown backend: ${current.backend}`);
  const sandbox = create(options);
  track(sandbox);
  return sandbox;
}

export function createSandbox(tools: CodemodeTool[] = []): CodemodeSandboxBase {
  return newSandbox({ tools, timeoutMs: 10_000 });
}

export function closeSandboxes(): Promise<void> {
  return Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.close())).then(() => undefined);
}

export const describeBackends: {
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

export const delayed: {
  <A>(value: A): (ms: number) => Promise<A>;
  <A>(ms: number, value: A): Promise<A>;
} = dual(2, <A>(ms: number, value: A): Promise<A> =>
  Effect.runPromise(Effect.sleep(ms).pipe(Effect.as(value))),
);

class ToolAborted extends Data.TaggedError("ToolAborted")<{ readonly message: string }> {}

export const rejectOnAbort: {
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

export const echo: CodemodeTool = { name: "echo", execute: (args) => args };

export const PNG = "iVBORw0KGgo=";
export const JPEG = "/9j/4A==";
export const GIF = "R0lGODlh";
export const WEBP = "UklGRgAAAABXRUJQ";
