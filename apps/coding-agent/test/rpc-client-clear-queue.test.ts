import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

type RpcClientPrivate = {
  send: (command: { type: string }) => Promise<unknown>;
  getData: <T>(response: unknown) => T;
};

describe("RpcClient clearQueue", () => {
  it("sends the clear_queue RPC command", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const client = new RpcClient();
        const privateClient = client as unknown as RpcClientPrivate;
        const send = vi.fn(() =>
          effectRunPromise(
            awaited({
              type: "response",
              command: "clear_queue",
              success: true,
              data: { steering: ["Change direction"], followUp: ["Summarize when finished"] },
            }),
          ),
        );
        privateClient.send = send;
        privateClient.getData = <T>(response: unknown): T => (response as { data: T }).data;

        const result = yield* awaited(client.clearQueue());

        expect(send).toHaveBeenCalledWith({ type: "clear_queue" });
        expect(result).toEqual({
          steering: ["Change direction"],
          followUp: ["Summarize when finished"],
        });
      }),
    ));
});
