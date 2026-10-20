import type authorizationInputTypes from "./authorization-input.types.ts";

const parseAuthorizationInput = (input: string): authorizationInputTypes.AuthorizationInput => {
  const value = input.trim();
  if (value === "") return {};

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {}

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }

  return { code: value };
};

const authorizationInput = {
  parseAuthorizationInput,
};

export default authorizationInput;
