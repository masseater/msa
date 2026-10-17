export const CALLBACK_HOST = "127.0.0.1";
export const CALLBACK_PORT = 1456;
export const CALLBACK_PATH = "/oauth/callback";
export const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;
export const OAUTH_CLIENT_ID = "msa-gateway";
export const OAUTH_SCOPE = "gateway offline_access";
export const OAUTH_DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export type DeviceAuthorizationResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number | undefined;
};
