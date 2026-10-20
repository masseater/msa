import type loginFlowTypes from "./login-flow.types.ts";

export default abstract class LoginFlowLayer0 {
  constructor(host: loginFlowTypes.LoginFlowHost) {
    this.host = host;
  }

  protected host!: loginFlowTypes.LoginFlowHost;
}
