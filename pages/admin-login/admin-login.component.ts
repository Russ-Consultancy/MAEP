import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminAuthService } from '../../admin/admin-auth.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-wrap">
      <form class="card" (ngSubmit)="submit()">
        <h1>MAEP Admin</h1>
        <p class="muted">Sign in to manage applications and view login activities.</p>

        <label>Username
          <input [(ngModel)]="username" name="username" required autocomplete="username" />
        </label>
        <label>Password
          <input [(ngModel)]="password" name="password" type="password" required autocomplete="current-password" />
        </label>

        <div class="error" *ngIf="error">{{ error }}</div>

        <button class="btn" type="submit" [disabled]="busy()">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  `,
  styles: [`
    .login-wrap { min-height: 100vh; display:flex; align-items:center; justify-content:center;
      background: linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%); font-family: system-ui, sans-serif; }
    .card { background:#fff; border-radius:12px; padding:32px; width:360px; max-width:90vw; box-shadow:0 20px 60px rgba(0,0,0,.2); }
    h1 { margin:0 0 4px 0; font-size:1.5rem; }
    .muted { margin:0 0 16px 0; color:#6b7280; font-size:.9rem; }
    label { display:block; margin: 12px 0; font-size: .85rem; color:#374151; }
    input { width:100%; padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; margin-top:4px; box-sizing:border-box; }
    .btn { width:100%; margin-top: 16px; padding:10px; background:#1e3a8a; color:#fff; border:0; border-radius:6px; cursor:pointer; font-weight:600; }
    .btn:disabled { opacity:.6; cursor:not-allowed; }
    .error { background:#fee2e2; color:#991b1b; padding:8px 10px; border-radius:6px; margin-top:12px; font-size:.85rem; }
  `]
})
export class AdminLoginComponent {
  username = '';
  password = '';
  busy = signal(false);
  error = '';

  constructor(private auth: AdminAuthService, private router: Router) {}

  async submit(): Promise<void> {
    this.error = '';
    this.busy.set(true);
    try {
      await this.auth.login(this.username, this.password);
      await this.router.navigate(['/admin/app-configs']);
    } catch (e: any) {
      this.error = e?.error?.detail || e?.message || 'Sign-in failed.';
    } finally {
      this.busy.set(false);
    }
  }
}
