import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthConfig, OAuthService } from 'angular-oauth2-oidc';
import { firstValueFrom } from 'rxjs';
import { authConfig } from './auth.config';
import { AppConfig, AppConfigService } from './app-config/app-config.service';

export interface SsoLoginResponse {
  access_token: string;
  token_type: string;
  username: string;
  role: string | null;
  company: string | null;
  lastLogin?: string | null;
  compositeToken?: string | null;
  expires_at?: string | null;
  expires_in?: number | null;
}

/**
 * SSO BROKER auth service.
 *
 * Unlike the static module, this service does NOT rely on a single compiled-in
 * config. Instead it loads the target application's configuration from the
 * database (via AppConfigService) at runtime and reconfigures the OAuth client
 * for that application before starting/completing the PingOne flow. This lets a
 * single deployed login service serve many applications, each with its own
 * clientId, issuer, redirect URI and backend exchange endpoint.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  isAuthenticated = signal<boolean>(!!sessionStorage.getItem('authToken'));
  userRole = signal<string | null>(sessionStorage.getItem('userRole'));

  private activeApp: AppConfig | null = null;
  private readonly returnUrlKey = 'auth_return_url';
  private readonly appIdKey = 'auth_app_id';

  constructor(
    private readonly router: Router,
    private readonly http: HttpClient,
    private readonly oauthService: OAuthService,
    private readonly appConfigService: AppConfigService
  ) {
    this.migrateLegacyToken();
  }

  /** Load an application's config from the DB and prepare the OAuth client. */
  async initForApp(appId: string): Promise<AppConfig> {
    const cfg = await this.appConfigService.getAppConfig(appId);
    this.activeApp = cfg;
    sessionStorage.setItem(this.appIdKey, appId);
    this.configureOAuth();
    return cfg;
  }

  getActiveApp(): AppConfig | null {
    return this.activeApp;
  }

  getActivePingBaseUrl(): string {
    return authConfig.pingAicBaseUrl;
  }

  /** Starts the PingOne SSO flow for the currently loaded application. */
  async login(targetUrl: string = authConfig.defaultPostLoginRoute): Promise<void> {
    if (!this.activeApp) {
      const appId = sessionStorage.getItem(this.appIdKey);
      if (appId) {
        await this.initForApp(appId);
      }
    }
    if (!this.activeApp) {
      throw new Error('No application configuration loaded. Visit /login?app=<appId>.');
    }
    const safeTarget = (targetUrl && targetUrl !== 'undefined') ? targetUrl : '';
    console.log('[AEP] login: storing returnUrl =', JSON.stringify(safeTarget), 'for appId', this.activeApp.appId);
    sessionStorage.setItem(this.returnUrlKey, safeTarget);
    this.oauthService.initCodeFlow();
  }

  /**
   * Called from the `/auth/callback` route. Exchanges the OIDC code for tokens,
   * then calls the application-specific exchange endpoint with Ping identity
   * claims. For the broker, after success it redirects back to the originating
   * application (the `returnUrl` captured from `?returnUrl=`) carrying the
   * application token. If there is no returnUrl it lands on the app's internal
   * default route.
   */
  async completeLogin(): Promise<boolean> {
    const appId = sessionStorage.getItem(this.appIdKey);
    if (appId && !this.activeApp) {
      await this.initForApp(appId);
    }
    if (!this.activeApp) {
      throw new Error('No application configuration loaded for this callback.');
    }

    await this.oauthService.tryLoginCodeFlow();

    if (!this.oauthService.hasValidAccessToken()) {
      return false;
    }

    const email = await this.getSignedInEmail();
    if (!email) {
      throw new Error('Ping did not return an email claim for this user.');
    }

    const claims = this.oauthService.getIdentityClaims() as Record<string, unknown> | null;
    const givenName = (claims?.['given_name'] as string) || (claims?.['name'] as string) || null;
    const company = this.extractCompanyFromEmail(email);

    let response: SsoLoginResponse;
    try {
      response = await firstValueFrom(
        this.http.post<SsoLoginResponse>(this.activeApp.ssoLoginEndpoint, {
          username: email,
          email,
          company
        })
      );
      this.storeAppSession(response, email);
      if (givenName) {
        sessionStorage.setItem('userDisplayName', givenName);
      }
    } catch (err: any) {
      const detail = err?.error?.detail || err?.error?.message || err?.message || 'SSO login failed.';
      throw new Error(detail);
    }

    const returnUrl = sessionStorage.getItem(this.returnUrlKey);
    sessionStorage.removeItem(this.returnUrlKey);
    sessionStorage.removeItem(this.appIdKey);

    const fallbackRoute = this.activeApp.defaultPostLoginRoute || '/dashboard';
    const allowed = this.activeApp.allowedReturnUrls || [];

    if (returnUrl && returnUrl !== 'undefined' && this.isReturnUrlAllowed(returnUrl)) {
      console.log('[AEP] completeLogin: redirecting to returnUrl', returnUrl);
      this.redirectToApp(returnUrl, response.access_token, response.compositeToken, response.expires_at);
    } else {
      if (returnUrl && returnUrl !== 'undefined') {
        console.warn('[AEP] completeLogin: blocked returnUrl', returnUrl, 'falling back to', fallbackRoute);
      } else {
        console.log('[AEP] completeLogin: no returnUrl, falling back to', fallbackRoute);
      }
      let fallbackTarget: string;
      if (allowed.length > 0) {
        const baseOrigin = new URL(allowed[0]).origin;
        const path = fallbackRoute.startsWith('/') ? fallbackRoute : '/' + fallbackRoute;
        fallbackTarget = baseOrigin + path;
      } else {
        fallbackTarget = window.location.origin + fallbackRoute;
      }
      console.log('[AEP] completeLogin: fallback target', fallbackTarget);
      this.redirectToApp(fallbackTarget, response.access_token, response.compositeToken, response.expires_at);
    }
    return true;
  }

  getUsername(): string | null {
    return sessionStorage.getItem('username') || 'Guest';
  }

  getUser(): any {
    const claims = this.oauthService.getIdentityClaims();
    if (claims) {
      return claims;
    }
    const username = sessionStorage.getItem('username');
    const displayName = sessionStorage.getItem('userDisplayName');
    if (username || displayName) {
      return {
        preferred_username: username,
        name: displayName || username,
        given_name: displayName || username
      };
    }
    return null;
  }

  isSsoLogin(): boolean {
    return sessionStorage.getItem('loginType') === 'sso';
  }

  getUserRole(): string | null {
    return this.userRole();
  }

  getUserCompany(): string | null {
    return sessionStorage.getItem('userCompany');
  }

  getLastLogin(): string | null {
    return sessionStorage.getItem('lastLogin');
  }

  logout(): void {
    sessionStorage.removeItem(this.returnUrlKey);
    sessionStorage.removeItem(this.appIdKey);
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('username');
    sessionStorage.removeItem('lastLogin');
    sessionStorage.removeItem('userRole');
    sessionStorage.removeItem('userCompany');
    sessionStorage.removeItem('userDisplayName');
    sessionStorage.removeItem('loginType');
    sessionStorage.removeItem('TOKEN_KEY');
    this.isAuthenticated.set(false);
    this.userRole.set(null);
    if (this.oauthService.hasValidAccessToken()) {
      this.oauthService.logOut();
      return;
    }
    void this.router.navigate(['/login']);
  }

  getAccessToken(): string {
    return this.oauthService.getAccessToken();
  }

  /**
   * A returnUrl is allowed when it is a same-origin relative route, or its
   * origin matches one of the application's configured `allowedReturnUrls`.
   * This prevents the broker from being used as an open redirect.
   */
  private isReturnUrlAllowed(url: string): boolean {
    const app = this.activeApp;
    if (!app) {
      return false;
    }
    if (!url || url === 'undefined') {
      return false;
    }
    if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) {
      return true;
    }
    const allowed = app.allowedReturnUrls || [];
    if (allowed.length === 0) {
      return false;
    }
    try {
      const targetOrigin = new URL(url).origin;
      return allowed.some((a) => {
        try {
          return new URL(a).origin === targetOrigin;
        } catch {
          return a === targetOrigin;
        }
      });
    } catch {
      return false;
    }
  }

  private redirectToApp(url: string, token: string, compositeToken?: string | null, expiresAt?: string | null): void {
    const sep = url.includes('?') ? '&' : '?';
    let target = `${url}${sep}token=${encodeURIComponent(token)}`;
    if (compositeToken) {
      target += `&compositeToken=${encodeURIComponent(compositeToken)}`;
    }
    if (expiresAt) {
      target += `&expires_at=${encodeURIComponent(expiresAt)}`;
    }
    console.log('[AEP] redirectToApp: final target', target);
    window.location.href = target;
  }

  /**
   * Configures the OAuth client with the SINGLE shared PingOne OIDC client
   * (auth.config.ts). Every application uses the same registered client, so
   * there is nothing per-app to configure here.
   */
  private configureOAuth(): void {
    const o = authConfig.oidc;
    const oidc: AuthConfig = {
      issuer: o.issuer,
      clientId: o.clientId,
      scope: o.scope,
      responseType: o.responseType,
      redirectUri: o.redirectUri,
      postLogoutRedirectUri: o.postLogoutRedirectUri,
      loginUrl: o.loginUrl,
      tokenEndpoint: o.tokenEndpoint,
      userinfoEndpoint: o.userinfoEndpoint,
      logoutUrl: o.logoutUrl,
      requireHttps: o.requireHttps,
      strictDiscoveryDocumentValidation: o.strictDiscoveryDocumentValidation,
      showDebugInformation: o.showDebugInformation,
      oidc: true
    };
    this.oauthService.configure(oidc);
    this.oauthService.setStorage(sessionStorage);
    this.oauthService.setupAutomaticSilentRefresh();
  }

  private storeAppSession(response: any, email: string): void {
    const userName = response.username || response.user?.username || response.user?.name || email;
    const displayName = response.name || response.user?.name || response.displayName || null;
    const lastLogin = response.lastLogin || response.last_login || response.user?.lastLogin || null;
    const role = response.role || response.user?.role;
    const company = response.company || response.user?.company;

    sessionStorage.setItem('authToken', response.access_token);
    sessionStorage.setItem('username', userName);
    if (lastLogin) {
      sessionStorage.setItem('lastLogin', lastLogin);
    } else {
      sessionStorage.removeItem('lastLogin');
    }
    if (role) {
      sessionStorage.setItem('userRole', role);
      this.userRole.set(role);
    }
    if (company) {
      sessionStorage.setItem('userCompany', company);
    }
    if (displayName) {
      sessionStorage.setItem('userDisplayName', displayName);
    }
    sessionStorage.setItem('loginType', 'sso');
    this.isAuthenticated.set(true);
  }

  private async getSignedInEmail(): Promise<string | null> {
    const claims = this.oauthService.getIdentityClaims() as Record<string, unknown> | null;
    const claimEmail = this.pickEmail(claims);
    if (claimEmail) {
      return claimEmail;
    }
    const profile = (await this.oauthService.loadUserProfile()) as { info?: Record<string, unknown> };
    return this.pickEmail(profile.info || (profile as Record<string, unknown>));
  }

  private pickEmail(claims: Record<string, unknown> | null | undefined): string | null {
    if (!claims) {
      return null;
    }
    const value = claims['email'] || claims['mail'] || claims['preferred_username'] || claims['sub'];
    return typeof value === 'string' && value.includes('@') ? value.toLowerCase() : null;
  }

  private extractCompanyFromEmail(email: string): string {
    const domain = email.split('@')[1] || '';
    const firstDomainLabel = domain.split('.')[0] || '';
    return firstDomainLabel.split('-')[0].toUpperCase();
  }

  private migrateLegacyToken(): void {
    const legacy = localStorage.getItem('TOKEN_KEY');
    if (!sessionStorage.getItem('authToken') && legacy) {
      sessionStorage.setItem('authToken', legacy);
      localStorage.removeItem('TOKEN_KEY');
      this.isAuthenticated.set(true);
    }
  }
}
