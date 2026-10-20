import { Effect } from "effect";

const base64urlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const generatePKCE = (): Promise<{ verifier: string; challenge: string }> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const verifierBytes = new Uint8Array(32);
      crypto.getRandomValues(verifierBytes);
      const verifier = base64urlEncode(verifierBytes);

      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      const hashBuffer = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", data));
      const challenge = base64urlEncode(new Uint8Array(hashBuffer));

      return { challenge, verifier };
    }),
  );

const pkce = {
  generatePKCE,
};

export default pkce;
