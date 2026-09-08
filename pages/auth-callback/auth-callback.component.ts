import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../auth.service';

/**
 * Handles the PingOne OIDC redirect (`/auth/callback?code=...&state=...`).
 * Calls {@link AuthService.completeLogin} and forwards the user to the route
 * they originally requested (the originating app's returnUrl, or the configured
 * default for the active application).
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="auth-callback-container">
      <div class="auth-callback-card">
        <div class="auth-callback-content">
          <div class="spinner-wrapper">
            <div class="spinner"></div>
          </div>
          <h1 class="auth-callback-title">Signing You In</h1>
          <p class="auth-callback-subtitle">Completing the PingOne callback. Please wait...</p>

          <div *ngIf="error" class="auth-callback-error">
            {{ error }}
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .auth-callback-container {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #0066cc 0%, #004499 100%);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }
      .auth-callback-card {
        background: #ffffff;
        border-radius: 1rem;
        padding: 3rem;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
        max-width: 420px;
        width: 100%;
      }
      .auth-callback-content {
        text-align: center;
      }
      .spinner-wrapper {
        display: flex;
        justify-content: center;
        margin-bottom: 1.5rem;
      }
      .spinner {
        width: 48px;
        height: 48px;
        border: 4px solid #e5e7eb;
        border-top-color: #0066cc;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .auth-callback-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1f2937;
        margin: 0 0 0.5rem 0;
      }
      .auth-callback-subtitle {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0;
      }
      .auth-callback-error {
        margin-top: 1rem;
        background-color: #fee2e2;
        color: #dc2626;
        padding: 1rem;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        border-left: 4px solid #dc2626;
      }
    `
  ]
})
export class AuthCallbackComponent {
  error = '';

  constructor(
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    void this.handleCallback();
  }

  private async handleCallback(): Promise<void> {
    const error = this.route.snapshot.queryParamMap.get('error');
    const errorDescription = this.route.snapshot.queryParamMap.get('error_description');
    const code = this.route.snapshot.queryParamMap.get('code');
    const state = this.route.snapshot.queryParamMap.get('state');

    if (error) {
      await this.router.navigate(['/login'], {
        queryParams: { authError: errorDescription || error }
      });
      return;
    }

    if (!code || !state) {
      const callbackError =
        'Authorization callback did not include code and state. Verify that the redirect URI in your PingOne client matches the app callback URL and then sign in again.';
      await this.router.navigate(['/login'], {
        queryParams: { authError: callbackError }
      });
      return;
    }

    try {
      const isAuthenticated = await this.auth.completeLogin();

      if (!isAuthenticated) {
        await this.router.navigate(['/login'], {
          queryParams: {
            authError:
              'Sign-in could not be completed. Check the PingOne client configuration and try again.'
          }
        });
      }
    } catch (err: any) {
      console.error('Callback processing error:', err);
      const details =
        err?.error?.detail || err?.error || err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      const authError = `The authorization response was rejected. Details: ${details}`;
      await this.router.navigate(['/login'], {
        queryParams: { authError }
      });
    }
  }
}
