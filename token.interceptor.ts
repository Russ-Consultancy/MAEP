/**
 * Attaches the app access token as an `Authorization: Bearer ...` header for
 * PingOne calls, and the admin token (when present) for `/api/admin/*` and
 * the broker's relative `/api/activities` and `/api/app-configs` endpoints.
 */
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const pingToken = auth.getAccessToken();
  const adminToken = sessionStorage.getItem('aep_admin_token');

  const pingBaseUrl = auth.getActivePingBaseUrl();
  const isRelative = req.url.startsWith('/');
  const isPingApi = !!pingBaseUrl && req.url.startsWith(pingBaseUrl);

  if (req.headers.has('Authorization')) return next(req);

  if (adminToken && (req.url.startsWith('/api/admin') || req.url.startsWith('/api/activities') || req.url.startsWith('/api/app-configs'))) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${adminToken}` } }));
  }
  if (pingToken && (isRelative || isPingApi)) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${pingToken}` } }));
  }
  return next(req);
};
