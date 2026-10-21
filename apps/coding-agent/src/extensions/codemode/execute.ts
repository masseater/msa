import { dual } from "effect/Function";

import codemodeRun from "./codemode-run.ts";
import codemodeStore from "./codemode-store.ts";
import type toolTypes from "./tool.types.ts";

const { runCodemode } = codemodeRun;

type OnUpdate = ((result: toolTypes.CodemodeRunResult) => void) | undefined;

const executeCodemodeImpl = (
  toolCallId: string,
  input: toolTypes.CodemodeToolInput,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdate,
  ctx: toolTypes.CodemodeRunContext | undefined,
  options: toolTypes.CodemodeToolOptions = {},
): Promise<toolTypes.CodemodeRunResult> =>
  runCodemode({ ctx, input, onUpdate, options, signal, toolCallId });

const executeCodemode: {
  (
    toolCallId: string,
    input: toolTypes.CodemodeToolInput,
    signal: AbortSignal | undefined,
    onUpdate: OnUpdate,
    ctx: toolTypes.CodemodeRunContext | undefined,
    options?: toolTypes.CodemodeToolOptions,
  ): Promise<toolTypes.CodemodeRunResult>;
  (
    input: toolTypes.CodemodeToolInput,
    signal: AbortSignal | undefined,
    onUpdate: OnUpdate,
    ctx: toolTypes.CodemodeRunContext | undefined,
    options?: toolTypes.CodemodeToolOptions,
  ): (toolCallId: string) => Promise<toolTypes.CodemodeRunResult>;
} = dual((args: IArguments) => args.length >= 5, executeCodemodeImpl);

const execute = {
  executeCodemode,
  readCodemodeStore: codemodeStore.readCodemodeStore,
};

export default execute;
