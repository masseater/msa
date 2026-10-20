import { describe, expect, it } from "vite-plus/test";

import {
  MAX_PROVIDER_ERROR_BODY_CHARS,
  formatProviderError,
  normalizeProviderError,
} from "../src/utils/error-body.ts";

describe("normalizeProviderError", () => {
  it("extracts status and body from a string-body HTTP error", () => {
    const error = Object.assign(new Error("Classifier returned 403"), {
      body: '{"error":"blocked by gateway WAF"}',
      status: 403,
    });

    const norm = normalizeProviderError(error);

    expect(norm.status).toBe(403);
    expect(norm.body).toBe('{"error":"blocked by gateway WAF"}');
    expect(norm.messageCarriesBody).toBe(false);
  });

  it("reads the parsed body off an openai APIError when the message is opaque", () => {
    const error = Object.assign(new Error("403 status code (no body)"), {
      error: { error: "blocked by gateway WAF" },
      status: 403,
    });

    const norm = normalizeProviderError(error);

    expect(norm.status).toBe(403);
    expect(norm.body).toBe('{"error":"blocked by gateway WAF"}');
    expect(norm.messageCarriesBody).toBe(false);
  });

  it("preserves the message when @google/genai already folds the body into it", () => {
    const body = { error: { code: 403, message: "Permission denied" } };
    const error = Object.assign(new Error(JSON.stringify(body)), {
      status: 403,
    });

    const norm = normalizeProviderError(error);

    expect(norm.status).toBe(403);
    expect(norm.messageCarriesBody).toBe(true);
    expect(norm.message).toBe(JSON.stringify(body));
  });
});

describe("normalizeProviderError", () => {
  it("ignores a class-instance `error` field instead of serializing it", () => {
    class SdkInnerError {
      code = "EPROTO";
      internalState = {};
    }
    const error = Object.assign(new Error("TLS handshake failed"), {
      error: new SdkInnerError(),
      status: 502,
    });

    const norm = normalizeProviderError(error);

    expect(norm.body).toBeUndefined();
    expect(norm.message).toBe("TLS handshake failed");
    expect(norm.messageCarriesBody).toBe(true);
  });

  it("still surfaces a plain parsed JSON body object", () => {
    const error = Object.assign(new Error("400 status code (no body)"), {
      error: { field: "tools[0]", message: "schema validation failed" },
      status: 400,
    });

    const norm = normalizeProviderError(error);

    expect(norm.body).toBe('{"field":"tools[0]","message":"schema validation failed"}');
    expect(norm.messageCarriesBody).toBe(false);
  });
});

describe("normalizeProviderError", () => {
  it("JSON-stringifies a non-Error thrown value", () => {
    const norm = normalizeProviderError({ reason: "boom" });

    expect(norm.status).toBeUndefined();
    expect(norm.body).toBeUndefined();
    expect(norm.message).toBe('{"reason":"boom"}');
    expect(norm.messageCarriesBody).toBe(false);
  });

  it("treats an empty parsed body object as no body", () => {
    const error = Object.assign(new Error("403 status code (no body)"), {
      error: {},
      status: 403,
    });

    const norm = normalizeProviderError(error);

    expect(norm.body).toBeUndefined();
    expect(norm.messageCarriesBody).toBe(true);
  });

  it("truncates the body at the cap", () => {
    const longBody = "x".repeat(MAX_PROVIDER_ERROR_BODY_CHARS + 50);
    const error = Object.assign(new Error("failed"), {
      body: longBody,
      status: 500,
    });

    const norm = normalizeProviderError(error);

    expect(norm.body).toContain("... [truncated 50 chars]");
    expect(norm.body?.length).toBeLessThan(longBody.length);
  });

  it("sets messageCarriesBody when the message already contains the extracted body", () => {
    const error = Object.assign(new Error("500: upstream exploded"), {
      body: "upstream exploded",
      status: 500,
    });

    const norm = normalizeProviderError(error);

    expect(norm.messageCarriesBody).toBe(true);
  });
});

describe("formatProviderError", () => {
  it("surfaces status and body without a prefix", () => {
    const norm = normalizeProviderError(
      Object.assign(new Error("403 status code (no body)"), {
        error: { error: "blocked by gateway WAF" },
        status: 403,
      }),
    );

    const formatted = formatProviderError(norm);

    expect(formatted).toContain("403");
    expect(formatted).toContain("blocked by gateway WAF");
    expect(formatted).not.toBe("403 status code (no body)");
  });

  it("applies a provider prefix with status and body", () => {
    const norm = normalizeProviderError(
      Object.assign(new Error("403 status code (no body)"), {
        error: { error: "blocked by gateway WAF" },
        status: 403,
      }),
    );

    expect(formatProviderError(norm, "OpenAI API error")).toBe(
      'OpenAI API error (403): {"error":"blocked by gateway WAF"}',
    );
  });

  it("preserves the message (with prefix + status) when it already carries the body", () => {
    const body = JSON.stringify({ error: { message: "Permission denied" } });
    const norm = normalizeProviderError(Object.assign(new Error(body), { status: 403 }));

    expect(formatProviderError(norm, "OpenAI API error")).toBe(`OpenAI API error (403): ${body}`);
  });

  it("returns the bare message for a non-Error value", () => {
    const norm = normalizeProviderError({ reason: "boom" });

    expect(formatProviderError(norm)).toBe('{"reason":"boom"}');
  });
});
