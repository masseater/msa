export function hasCloudflareWorkersAICredentials(): boolean {
  return (
    process.env["CLOUDFLARE_API_KEY"] !== undefined &&
    process.env["CLOUDFLARE_API_KEY"] !== "" &&
    process.env["CLOUDFLARE_ACCOUNT_ID"] !== undefined &&
    process.env["CLOUDFLARE_ACCOUNT_ID"] !== ""
  );
}

export function hasCloudflareAiGatewayCredentials(): boolean {
  return (
    process.env["CLOUDFLARE_API_KEY"] !== undefined &&
    process.env["CLOUDFLARE_API_KEY"] !== "" &&
    process.env["CLOUDFLARE_ACCOUNT_ID"] !== undefined &&
    process.env["CLOUDFLARE_ACCOUNT_ID"] !== "" &&
    process.env["CLOUDFLARE_GATEWAY_ID"] !== undefined &&
    process.env["CLOUDFLARE_GATEWAY_ID"] !== ""
  );
}
