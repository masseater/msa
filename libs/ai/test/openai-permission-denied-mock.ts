import FakePermissionDeniedError from "./fake-permission-denied-error.ts";

const mockState = {
  parsedBody: { error: "blocked by gateway WAF" } as unknown,
};

function throwingCreate() {
  const promise = Promise.resolve(undefined) as unknown as { withResponse: () => Promise<never> };
  promise.withResponse = () =>
    Promise.reject(
      FakePermissionDeniedError.make({
        error: mockState.parsedBody,
        message: "403 status code (no body)",
        status: 403,
      }),
    );
  return promise;
}

class FakeOpenAI {
  chat = { completions: { create: throwingCreate } };
  responses = { create: throwingCreate };
}

const openaiPermissionDeniedMock = { default: FakeOpenAI, mockState };

export default openaiPermissionDeniedMock;
