import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { UserBashEvent, UserBashEventResult } from "../../../src/core/extensions/types.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";
import UserBashFailClosedSupport from "./9068-user-bash-fail-closed-support.ts";

const { localResult } = UserBashFailClosedSupport;

const { createHarness } = harnessModule;

const rpcIo = vi.hoisted(() => ({
  lineHandler: undefined as ((line: string) => void) | undefined,
  outputLines: [] as string[],
}));

vi.mock("../../../src/core/output-guard.js", () => ({
  flushRawStdout: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
  takeOverStdout: vi.fn(),
  waitForRawStdoutBackpressure: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
  writeRawStdout: (line: string) => {
    rpcIo.outputLines.push(line);
  },
}));

vi.mock("../../../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../../../src/modes/interactive/components/bash-execution.js", () => ({
  BashExecutionComponent: class {
    appendOutput(): void {}
    setComplete(): void {}
  },
}));

vi.mock("../../../src/modes/rpc/jsonl.js", () => ({
  attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
    rpcIo.lineHandler = onLine;
    return () => {
      rpcIo.lineHandler = undefined;
    };
  }),
  serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

type InteractiveBashContext = {
  defaultEditor: { onSubmit?: (text: string) => Promise<void> | void };
  editor: { addToHistory?: (text: string) => void };
  session: harnessTypes.Harness["session"];
  sessionManager: harnessTypes.Harness["sessionManager"];
  ui: { requestRender(): void };
  chatContainer: { addChild(component: unknown): void };
  pendingMessagesContainer: { addChild(component: unknown): void };
  pendingBashComponents: unknown[];
  isBashMode: boolean;
  handleBashCommand(command: string, excludeFromContext?: boolean): Promise<void>;
  showError(message: string): void;
  updateEditorBorderColor(): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as {
  setupEditorSubmitHandler(this: InteractiveBashContext): void;
  handleBashCommand(
    this: InteractiveBashContext,
    command: string,
    excludeFromContext?: boolean,
  ): Promise<void>;
};

afterEach(() => {
  rpcIo.outputLines = [];
  rpcIo.lineHandler = undefined;
});

const partPart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const events: UserBashEvent[] = [];
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("user_bash", (event) =>
              runPromise(
                Effect.sync(() => {
                  events.push(event);
                  return {} as unknown as UserBashEventResult;
                }),
              ),
            );
          },
        ],
      }),
    );
    return { events, harness };
  });

describe("Interactive user_bash failure handling (#9068)", () => {
  test.each([
    ["!pwd", false],
    ["!!pwd", true],
  ])("fails closed for %s when a handler returns an empty result", (input, excludeFromContext) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { events, harness } = yield* partPart1();
        const executeBash = vi.spyOn(harness.session, "executeBash").mockResolvedValue(localResult);
        const context: InteractiveBashContext = {
          chatContainer: { addChild: vi.fn() },
          defaultEditor: {},
          editor: { addToHistory: vi.fn() },
          handleBashCommand: interactiveModePrototype.handleBashCommand,
          isBashMode: true,
          pendingBashComponents: [],
          pendingMessagesContainer: { addChild: vi.fn() },
          session: harness.session,
          sessionManager: harness.sessionManager,
          showError: vi.fn(),
          ui: { requestRender: vi.fn() },
          updateEditorBorderColor: vi.fn(),
        };
        interactiveModePrototype.setupEditorSubmitHandler.call(context);

        try {
          yield* Effect.promise(() => Promise.resolve(context.defaultEditor.onSubmit?.(input)));

          expect(events).toEqual([
            {
              command: "pwd",
              cwd: harness.sessionManager.getCwd(),
              excludeFromContext,
              type: "user_bash",
            },
          ]);
          expect(executeBash).not.toHaveBeenCalled();
        } finally {
          executeBash.mockRestore();
          harness.cleanup();
        }
      }),
    ),
  );
});
