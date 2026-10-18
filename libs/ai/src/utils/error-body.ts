import { Function } from "effect";
export const MAX_PROVIDER_ERROR_BODY_CHARS = 4000;

export interface NormalizedProviderError {
  status?: number | undefined;
  body?: string | undefined;
  message: string;
  messageCarriesBody: boolean;
}

type SdkErrorShape = Error & {
  status?: unknown;
  body?: unknown;
  error?: unknown;
};

export function normalizeProviderError(error: unknown): NormalizedProviderError {
  if (!(error instanceof Error)) {
    return { message: safeJsonStringify(error), messageCarriesBody: false };
  }

  const sdkError = error as SdkErrorShape;
  const status = extractStatus(sdkError);
  const body = extractBody(sdkError);
  const messageCarriesBody = body === undefined || error.message.includes(body);

  return {
    status,
    body,
    message: error.message,
    messageCarriesBody,
  } satisfies NormalizedProviderError;
}

function extractStatus(error: SdkErrorShape): number | undefined {
  if (typeof error.status === "number") return error.status;
  return undefined;
}

function extractBody(error: SdkErrorShape): string | undefined {
  const bodyText = pickBodyText(error);
  if (bodyText === undefined) return undefined;
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) return undefined;
  return truncateErrorText(trimmed, MAX_PROVIDER_ERROR_BODY_CHARS);
}

function pickBodyText(error: SdkErrorShape): string | undefined {
  if (typeof error.body === "string") return error.body;
  if (isPlainNonEmptyObject(error.error)) return safeJsonStringify(error.error);
  return undefined;
}

function isPlainNonEmptyObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(value).length > 0;
}

export const formatProviderError: {
  (prefix?: string): (norm: NormalizedProviderError) => string;
  (norm: NormalizedProviderError, prefix?: string): string;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null,
  function (norm: NormalizedProviderError, prefix?: string): string {
    if (norm.messageCarriesBody || norm.status === undefined || norm.body === undefined) {
      return prefix !== undefined && norm.status !== undefined
        ? `${prefix} (${norm.status}): ${norm.message}`
        : norm.message;
    }
    return prefix === undefined
      ? `${norm.status}: ${norm.body}`
      : `${prefix} (${norm.status}): ${norm.body}`;
  },
);

export const truncateErrorText: {
  (maxChars: number): (text: string) => string;
  (text: string, maxChars: number): string;
} = Function.dual(2, function (text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
});

export function safeJsonStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}
