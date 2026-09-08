import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { dbAdminGuard } from './admin/db-admin.guard';
import { LoginComponent } from './pages/login/login.component';
import { AuthCallbackComponent } from './pages/auth-callback/auth-callback.component';
import { AppConfigEditorComponent } from './pages/app-config-editor/app-config-editor.component';

/**
 * Routes for the SSO BROKER app. Every consuming application redirects here with
 * ?app=<appId>&returnUrl=<url-to-go-back-to>.
 */
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./pages/auth-callback/auth-callback.component').then((m) => m.AuthCallbackComponent)
  },
  {
    path: 'admin/login',
    loadComponent: () =>
      import('./pages/admin-login/admin-login.component').then((m) => m.AdminLoginComponent)
  },
  {
    path: 'admin/app-configs',
    canActivate: [dbAdminGuard],
    loadComponent: () =>
      import('./pages/app-config-editor/app-config-editor.component').then((m) => m.AppConfigEditorComponent)
  },
  {
    path: 'admin/activities',
    canActivate: [dbAdminGuard],
    loadComponent: () =>
      import('./pages/activities/activities.component').then((m) => m.ActivitiesComponent)
  },
  {
    path: '',
    loadComponent: () =>
      import('./pages/admin-login/admin-login.component').then((m) => m.AdminLoginComponent)
  },
  { path: '**', redirectTo: '/admin/login' }
];
