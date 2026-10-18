import type { TextSignatureV1 } from "../types.ts";

type Phase = TextSignatureV1["phase"];

export interface ParsedTextSignature {
  readonly id: string;
  readonly phase?: Phase;
}

export function encodeTextSignatureV1({ id, phase }: ParsedTextSignature): string {
  const payload: TextSignatureV1 = { v: 1, id };
  if (phase !== undefined) payload.phase = phase;
  return JSON.stringify(payload);
}

function parseJsonSignature(signature: string): ParsedTextSignature | undefined {
  try {
    const parsed = JSON.parse(signature) as Partial<TextSignatureV1>;
    if (parsed.v !== 1 || typeof parsed.id !== "string") return undefined;
    if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
      return { id: parsed.id, phase: parsed.phase };
    }
    return { id: parsed.id };
  } catch {
    return undefined;
  }
}

export function parseTextSignature(signature: string | undefined): ParsedTextSignature | undefined {
  if (signature === undefined || signature === "") return undefined;
  const parsed = signature.startsWith("{") ? parseJsonSignature(signature) : undefined;
  return parsed ?? { id: signature };
}
