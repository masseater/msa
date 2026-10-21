declare namespace deviceCodeTypes {
  type OAuthDeviceCodeIncompletePollResult =
    | { status: "pending" }
    | { status: "slow_down"; intervalSeconds?: number | undefined }
    | { status: "failed"; message: string };

  type OAuthDeviceCodePollResult<T> =
    | OAuthDeviceCodeIncompletePollResult
    | { status: "complete"; value: T };

  type OAuthDeviceCodePollOptions<T> = {
    intervalSeconds?: number | undefined;
    expiresInSeconds?: number | undefined;
    waitBeforeFirstPoll?: boolean | undefined;
    poll: () => Promise<OAuthDeviceCodePollResult<T>>;
    signal: AbortSignal;
  };
}

export type { deviceCodeTypes as default };
