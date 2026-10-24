import assert from "node:assert";
import { describe, it } from "node:test";

import ansiSequences from "../src/ansi-sequences.ts";
import programStatus from "../src/program-status.ts";

const { formatAttentionAlert, formatProgramStatus, isProgramStatusReply, programStatusReplyKinds } =
  programStatus;
const { parseEscapeSequence } = ansiSequences;

function decodeMessage(sequence: string): string | undefined {
  const message = /:msg=([A-Za-z0-9+/=]*)/u.exec(sequence)?.[1];
  return message === undefined ? undefined : Buffer.from(message, "base64").toString("utf8");
}

describe("formatProgramStatus", () => {
  it("encodes state, app, kind, and a base64 message", () => {
    assert.equal(
      formatProgramStatus({
        app: "msa",
        kind: "permission",
        message: "Allow bash?",
        state: "blocked",
      }),
      `\x1b]7501;state=blocked:app=msa:kind=permission:msg=${Buffer.from("Allow bash?").toString("base64")}\x1b\\`,
    );
    assert.equal(formatProgramStatus({ state: "clear" }), "\x1b]7501;state=clear\x1b\\");
  });

  it("omits kind outside blocked, invalid app names, and empty messages", () => {
    assert.equal(
      formatProgramStatus({ app: "my app", kind: "auth", message: " \n ", state: "working" }),
      "\x1b]7501;state=working\x1b\\",
    );
    const padded = formatProgramStatus({ app: "a".repeat(32), state: "idle" });
    assert.equal(parseEscapeSequence(padded)?.body, `7501;state=idle:app=${"a".repeat(32)}`);
    assert.doesNotMatch(formatProgramStatus({ app: "a".repeat(33), state: "idle" }), /app=/u);
  });

  it("replaces control characters, which make terminals discard the report", () => {
    const sequence = formatProgramStatus({
      message: "first\nsecond\x1b[31m\u009bthird\t",
      state: "error",
    });
    assert.equal(decodeMessage(sequence), "first second [31m third");
  });

  it("cuts long messages at a UTF-8 boundary within the spec limits", () => {
    const sequence = formatProgramStatus({
      app: "msa",
      message: "é".repeat(2000),
      state: "working",
    });
    const message = decodeMessage(sequence)!;
    assert.equal(message, "é".repeat(1024));
    assert.ok(Buffer.byteLength(message) <= 2048);
    assert.ok(sequence.length <= 4096);
  });
});

describe("isProgramStatusReply", () => {
  it("accepts the query echo with either terminator and future pairs", () => {
    assert.equal(isProgramStatusReply("\x1b]7501;?\x1b\\"), true);
    assert.equal(isProgramStatusReply("\x1b]7501;?\x07"), true);
    assert.equal(isProgramStatusReply("\x1b]7501;?version=2\x1b\\"), true);
    assert.equal(isProgramStatusReply("\x1b]7501;state=idle\x1b\\"), false);
    assert.equal(isProgramStatusReply("\x1b]11;rgb:0000/0000/0000\x07"), false);
  });
});

describe("blocked kinds", () => {
  const quota = { kind: "quota", message: "out of credits", state: "blocked" } as const;

  it("sends a kind the terminal does not list as a plain blocked report", () => {
    assert.doesNotMatch(formatProgramStatus(quota), /kind=/u);
    assert.match(formatProgramStatus({ ...quota, kind: "auth" }), /:kind=auth:/u);
  });

  it("sends the kind when the terminal lists it", () => {
    const kinds = programStatusReplyKinds(
      "\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth,quota\x1b\\",
    );
    assert.match(formatProgramStatus(quota, kinds), /:kind=quota:/u);
  });

  it("reads a reply without kinds as the three base kinds", () => {
    assert.deepEqual(
      [...programStatusReplyKinds("\x1b]7501;?\x1b\\")],
      ["permission", "question", "auth"],
    );
  });
});

describe("formatAttentionAlert", () => {
  it("rings the bell and raises an OSC 9 and OSC 777 notification", () => {
    assert.equal(
      formatAttentionAlert("msa", "Model calls stopped"),
      "\x1b]9;msa: Model calls stopped\x07\x1b]777;notify;msa;Model calls stopped\x07\x07",
    );
  });

  it("wraps each OSC in tmux passthrough and leaves the bell for tmux to forward", () => {
    assert.equal(
      formatAttentionAlert("msa", "stopped", { tmux: true }),
      "\x1bPtmux;\x1b\x1b]9;msa: stopped\x07\x1b\\" +
        "\x1bPtmux;\x1b\x1b]777;notify;msa;stopped\x07\x1b\\" +
        "\x07",
    );
  });

  it("keeps the text inside one OSC field", () => {
    const sequence = formatAttentionAlert("msa", "402: a;b\x07\x1b]0;x");
    assert.equal(sequence.split("\x07").length, 4);
    assert.ok(sequence.includes("notify;msa;402: a,b ]0,x\x07"));
  });
});
