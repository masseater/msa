import type typesModule from "../types.types.ts";
import type openaiResponsesSignatureTypes from "./openai-responses-signature.types.ts";

function encodeTextSignatureV1({
  id,
  phase,
}: openaiResponsesSignatureTypes.ParsedTextSignature): string {
  const payload: typesModule.TextSignatureV1 = { id, v: 1 };
  if (phase !== undefined) payload.phase = phase;
  return JSON.stringify(payload);
}

function parseJsonSignature(
  signature: string,
): openaiResponsesSignatureTypes.ParsedTextSignature | undefined {
  try {
    const parsed = JSON.parse(signature) as Partial<typesModule.TextSignatureV1>;
    if (parsed.v !== 1 || typeof parsed.id !== "string") return undefined;
    if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
      return { id: parsed.id, phase: parsed.phase };
    }
    return { id: parsed.id };
  } catch {
    return undefined;
  }
}

function parseTextSignature(
  signature: string | undefined,
): openaiResponsesSignatureTypes.ParsedTextSignature | undefined {
  if (signature === undefined || signature === "") return undefined;
  const parsed = signature.startsWith("{") ? parseJsonSignature(signature) : undefined;
  return parsed ?? { id: signature };
}

const openaiResponsesSignature = {
  encodeTextSignatureV1,
  parseTextSignature,
};

export default openaiResponsesSignature;
