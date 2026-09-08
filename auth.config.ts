/**
 * AEP (SSO BROKER) — default/fallback config.
 *
 * In broker mode the REAL configuration is loaded per-application from the
 * database at runtime via AppConfigService. This static file is only a safe
 * fallback used before any app config has been loaded (and for local dev when
 * the DB is unavailable). Edit the per-app values through the App Config Editor
 * UI instead of here.
 */

export interface PingoneOidcConfig {
  issuer: string;
  clientId: string;
  scope: string;
  responseType: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  loginUrl: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  logoutUrl: string;
  jwksUri?: string;
  requireHttps: boolean;
  strictDiscoveryDocumentValidation: boolean;
  showDebugInformation: boolean;
}

export interface PingoneAuthConfig {
  pingAicBaseUrl: string;
  backendApiUrl: string;
  ssoLoginEndpoint: string;
  defaultPostLoginRoute: string;
  oidc: PingoneOidcConfig;
}

export const authConfig: PingoneAuthConfig = {
  pingAicBaseUrl: '',
  backendApiUrl: '',
  ssoLoginEndpoint: '/api/auth/sso-login',
  defaultPostLoginRoute: '/dashboard',
  oidc: {
    issuer: 'https://openam-bruneishell-ase1-dev.id.forgerock.io:443/am/oauth2/alpha',
    clientId: 'OIDCLogin',
    scope: 'openid profile email fr:idm:*',
    responseType: 'code',
    redirectUri: 'http://localhost:4200/auth/callback',
    postLogoutRedirectUri: 'http://localhost:4200/login',
    loginUrl: 'https://openam-bruneishell-ase1-dev.id.forgerock.io:443/am/oauth2/alpha/authorize',
    tokenEndpoint: '/am/oauth2/alpha/access_token',
    userinfoEndpoint: '/am/oauth2/alpha/userinfo',
    logoutUrl: 'https://openam-bruneishell-ase1-dev.id.forgerock.io:443/am/oauth2/alpha/connect/endSession',
    jwksUri: '/am/oauth2/alpha/connect/jwk_uri',
    requireHttps: false,
    strictDiscoveryDocumentValidation: false,
    showDebugInformation: false
  }
};
