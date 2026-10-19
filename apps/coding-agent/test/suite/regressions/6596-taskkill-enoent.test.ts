import { EventEmitter } from "node:events";

import { joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("child_process", (importOriginal) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const actual = yield* Effect.promise(() => importOriginal<typeof import("child_process")>());
      return { ...actual, spawn: spawnMock };
    }),
  ),
);

import { killProcessTree } from "../../../src/utils/shell.ts";

function withWindowsPlatform(test: () => void): void {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    test();
  } finally {
    if (platformDescriptor !== undefined)
      Object.defineProperty(process, "platform", platformDescriptor);
  }
}

afterEach(() => {
  spawnMock.mockReset();
});

const usesSystem32TaskkillAndConsumesIts = () => {
  const child = new EventEmitter();
  vi.stubEnv("SystemRoot", "C:\\CustomWindows");
  spawnMock.mockReturnValue(child);

  try {
    withWindowsPlatform(() => {
      killProcessTree(1234);
    });
  } finally {
    vi.unstubAllEnvs();
  }

  expect(spawnMock).toHaveBeenCalledWith(
    joinPath("C:\\CustomWindows", "System32", "taskkill.exe"),
    ["/F", "/T", "/PID", "1234"],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  expect(() => child.emit("error", new Error("spawn taskkill ENOENT"))).not.toThrow();
};

describe("issue #6596 taskkill spawn failures", () => {
  it(
    "uses System32 taskkill and consumes its asynchronous spawn error",
    usesSystem32TaskkillAndConsumesIts,
  );
});
