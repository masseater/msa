import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const { awaited, runTest } = testing;

type RpcClientPrivate = {
  send: (command: { type: string }) => Promise<unknown>;
  getData: <T>(response: unknown) => T;
};

describe("RpcClient clone", () => {
  it("sends the clone RPC command", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const client = new RpcClient();
        const privateClient = client as unknown as RpcClientPrivate;
        const send = vi.fn(() =>
          effectRunPromise(
            awaited({
              command: "clone",
              data: { cancelled: false },
              success: true,
              type: "response",
            }),
          ),
        );
        privateClient.send = send;
        privateClient.getData = <T>(response: unknown): T => (response as { data: T }).data;

        const result = yield* awaited(client.clone());

        expect(send).toHaveBeenCalledWith({ type: "clone" });
        expect(result).toEqual({ cancelled: false });
      }),
    ));
});
