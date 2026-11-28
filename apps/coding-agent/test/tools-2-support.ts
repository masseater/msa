import testing from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type src from "../src/index.ts";

const { awaited, readTextFile, writeTextFile } = testing;

function getTextOutput(result: any): string {
  return (
    result.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || ""
  );
}

interface RejectedEdit {
  callId: string;
  content: string;
  edits: { newText: string; oldText: string }[];
  path: string;
  pattern: RegExp;
}

const expectEditRejected = (
  editTool: ReturnType<typeof src.createEditTool>,
  { callId, content, edits, path, pattern }: RejectedEdit,
) =>
  Effect.gen(function* () {
    yield* writeTextFile(path, content);
    yield* awaited(expect(editTool.execute(callId, { edits, path })).rejects.toThrow(pattern));
    expect(yield* readTextFile(path)).toBe(content);
  });

const tools2Support = {
  expectEditRejected,
  getTextOutput,
};

export default tools2Support;
