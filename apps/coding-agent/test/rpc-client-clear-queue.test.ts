import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import RpcClient from "../src/modes/rpc/rpc-client.ts";
const { awaited, runTest } = testing;

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
              command: "clear_queue",
              data: { followUp: ["Summarize when finished"], steering: ["Change direction"] },
              success: true,
              type: "response",
            }),
          ),
        );
        privateClient.send = send;
        privateClient.getData = <T>(response: unknown): T => (response as { data: T }).data;

        const result = yield* awaited(client.clearQueue());

        expect(send).toHaveBeenCalledWith({ type: "clear_queue" });
        expect(result).toEqual({
          followUp: ["Summarize when finished"],
          steering: ["Change direction"],
        });
      }),
    ));
});
