import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

const TOKEN_KEY = 'aep_admin_token';
const USER_KEY  = 'aep_admin_user';

@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  isAuthenticated = signal<boolean>(!!sessionStorage.getItem(TOKEN_KEY));
  username = signal<string | null>(sessionStorage.getItem(USER_KEY));

  constructor(private readonly http: HttpClient) {}

  async login(username: string, password: string): Promise<void> {
    const res: any = await firstValueFrom(this.http.post('/api/admin/login', { username, password }));
    sessionStorage.setItem(TOKEN_KEY, res.token);
    sessionStorage.setItem(USER_KEY, res.username);
    this.isAuthenticated.set(true);
    this.username.set(res.username);
  }

  logout(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    this.isAuthenticated.set(false);
    this.username.set(null);
  }

  getToken(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
  }
}
