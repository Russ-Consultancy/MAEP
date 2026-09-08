import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';

/**
 * The per-application login configuration stored in the database and served by
 * the broker backend (`GET /api/app-configs/:appId`).
 *
 * NOTE: the PingOne OIDC client is registered ONCE and shared by every
 * application, so its settings (issuer, clientId, redirectUri, endpoints,
 * scope...) live in a single shared config (`auth.config.ts`). This per-app
 * record only carries what is genuinely different for each application.
 */
export interface AppConfig {
  /** Stable unique key used in the `?app=` redirect, e.g. "hr-portal". */
  appId: string;
  /** Human readable name shown on the login page. */
  appName: string;
  /** The application's own backend exchange endpoint (Ping claims -> app token). */
  ssoLoginEndpoint: string;
  /** Where to send the user inside the app after login (when no returnUrl is given). */
  defaultPostLoginRoute: string;
  /** Absolute base URL of the application's own backend (empty when proxied). */
  backendApiUrl: string;
  /** Origins the broker is allowed to redirect back to after login (open-redirect protection). */
  allowedReturnUrls?: string[];
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly baseUrl = '/api/app-configs';

  constructor(private readonly http: HttpClient) {}

  list(): Observable<AppConfig[]> {
    return this.http.get<AppConfig[]>(this.baseUrl);
  }

  getAppConfig(appId: string): Promise<AppConfig> {
    return firstValueFrom(
      this.http.get<AppConfig>(`${this.baseUrl}/${encodeURIComponent(appId)}`)
    ).then((cfg) => {
      if (!cfg || !cfg.appId || !cfg.ssoLoginEndpoint) {
        throw new Error(`Application "${appId}" is not configured.`);
      }
      return cfg;
    });
  }

  create(cfg: AppConfig): Observable<AppConfig> {
    return this.http.post<AppConfig>(this.baseUrl, cfg);
  }

  update(appId: string, cfg: AppConfig): Observable<AppConfig> {
    return this.http.put<AppConfig>(`${this.baseUrl}/${encodeURIComponent(appId)}`, cfg);
  }

  delete(appId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${encodeURIComponent(appId)}`);
  }
}
