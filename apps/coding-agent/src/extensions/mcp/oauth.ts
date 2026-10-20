import oauthPart2 from "./oauth-part2.ts";
import oauthPart4 from "./oauth-part4.ts";

const { createMcpAuthProvider } = oauthPart2;
const { signInMcpServer } = oauthPart4;

const oauthModule = {
  createMcpAuthProvider,
  signInMcpServer,
};

export default oauthModule;
