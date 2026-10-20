import { Effect } from "effect";

import type typesUiTypes from "../../core/extensions/types-ui.ts";
import pathModule from "../path.ts";
import type rpcTypesTypes from "./rpc-types.ts";

const { randomUuid } = pathModule;

function createExtensionUIContextPart2(
  content: unknown,
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void,
  key: string,
  options: typesUiTypes.ExtensionWidgetOptions | undefined,
) {
  if (content === undefined || Array.isArray(content)) {
    output({
      id: randomUuid(),
      method: "setWidget",
      type: "extension_ui_request",
      widgetKey: key,
      widgetLines: content as string[] | undefined,
      widgetPlacement: options?.placement,
    } as rpcTypesTypes.RpcExtensionUIRequest);
  }
}

function createExtensionUIContextPart1(
  pendingExtensionRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >,
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void,
  prefill: string | undefined,
  title: string,
): Promise<string | undefined> {
  const id = randomUuid();
  return Effect.runPromise(
    Effect.callback<string | undefined, Error>((resume) => {
      pendingExtensionRequests.set(id, {
        reject: (failure: Error) => resume(Effect.fail(failure)),
        resolve: (response: rpcTypesTypes.RpcExtensionUIResponse) => {
          const text =
            "value" in response && !("cancelled" in response && response.cancelled === true)
              ? response.value
              : undefined;
          resume(Effect.succeed(text));
        },
      });
      output({
        id,
        method: "editor",
        prefill,
        title,
        type: "extension_ui_request",
      } as rpcTypesTypes.RpcExtensionUIRequest);
    }),
  );
}

const rpcModePart3Part1 = {
  createExtensionUIContextPart1,
  createExtensionUIContextPart2,
};

export default rpcModePart3Part1;
