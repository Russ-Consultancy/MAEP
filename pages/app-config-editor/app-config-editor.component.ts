import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { AppConfig, AppConfigService } from '../../app-config/app-config.service';
import { AdminAuthService } from '../../admin/admin-auth.service';

type EditorMode = 'list' | 'form';

@Component({
  selector: 'app-config-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './app-config-editor.html',
  styleUrls: ['./app-config-editor.css']
})
export class AppConfigEditorComponent implements OnInit {
  configs = signal<AppConfig[]>([]);
  mode: EditorMode = 'list';
  isNew = false;
  saving = false;
  loading = true;
  error = '';
  searchQuery = '';

  form: AppConfig = this.blank();
  returnUrlsText = '';

  // dynamic status computed from endpoint reachability
  statuses = signal<Record<string, { ok: boolean; detail: string }>>({});
  testing = signal<Record<string, boolean>>({});

  filtered = computed(() => {
    const q = this.searchQuery.trim().toLowerCase();
    const list = this.configs();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.appId.toLowerCase().includes(q) ||
        c.appName.toLowerCase().includes(q) ||
        c.ssoLoginEndpoint.toLowerCase().includes(q)
    );
  });

  constructor(
    private readonly svc: AppConfigService,
    private readonly adminAuth: AdminAuthService,
    private readonly router: Router
  ) {}

  signOut(): void {
    this.adminAuth.logout();
    void this.router.navigate(['/admin/login']);
  }

  ngOnInit(): void {
    void this.load();
  }

  private blank(): AppConfig {
    return {
      appId: '',
      appName: '',
      ssoLoginEndpoint: '',
      defaultPostLoginRoute: '/dashboard',
      backendApiUrl: '',
      allowedReturnUrls: []
    };
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.configs.set(await firstValueFrom(this.svc.list().pipe(timeout(8000))));
      this.statuses.set({});
      this.testing.set({});
    } catch (e: any) {
      this.error = e?.message || 'Failed to load application configurations.';
    } finally {
      this.loading = false;
    }
  }

  add(): void {
    this.isNew = true;
    this.form = this.blank();
    this.returnUrlsText = '';
    this.mode = 'form';
    this.error = '';
  }

  edit(cfg: AppConfig): void {
    this.isNew = false;
    this.form = JSON.parse(JSON.stringify(cfg));
    this.returnUrlsText = (cfg.allowedReturnUrls || []).join(', ');
    this.mode = 'form';
    this.error = '';
  }

  cancel(): void {
    this.mode = 'list';
    this.form = this.blank();
    this.error = '';
  }

  async save(): Promise<void> {
    this.saving = true;
    this.error = '';
    try {
      this.form.allowedReturnUrls = this.returnUrlsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (this.isNew) {
        await firstValueFrom(this.svc.create(this.form));
      } else {
        await firstValueFrom(this.svc.update(this.form.appId, this.form));
      }
      this.mode = 'list';
      this.form = this.blank();
      await this.load();
    } catch (e: any) {
      this.error = e?.error?.detail || e?.error?.message || e?.message || 'Save failed.';
    } finally {
      this.saving = false;
    }
  }

  async remove(cfg: AppConfig): Promise<void> {
    if (!confirm(`Delete application "${cfg.appId}"? This cannot be undone.`)) return;
    try {
      await firstValueFrom(this.svc.delete(cfg.appId));
      await this.load();
    } catch (e: any) {
      this.error = e?.message || 'Delete failed.';
    }
  }

  async testEndpoint(cfg: AppConfig): Promise<void> {
    this.testing.update((t) => ({ ...t, [cfg.appId]: true }));
    this.statuses.update((s) => ({ ...s, [cfg.appId]: { ok: false, detail: 'Testing…' } }));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(cfg.ssoLoginEndpoint, {
        method: 'OPTIONS',
        mode: 'cors',
        signal: controller.signal
      });
      clearTimeout(timer);
      const detail = `Reachable (HTTP ${res.status})`;
      this.statuses.update((s) => ({ ...s, [cfg.appId]: { ok: res.status < 500, detail } }));
    } catch (e: any) {
      this.statuses.update((s) => ({ ...s, [cfg.appId]: { ok: false, detail: e?.message || 'Unreachable' } }));
    } finally {
      this.testing.update((t) => {
        const next = { ...t };
        delete next[cfg.appId];
        return next;
      });
    }
  }

  exportJson(): void {
    const blob = new Blob([JSON.stringify(this.configs(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `app-configs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importJson(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : [data];
      let imported = 0;
      for (const cfg of list) {
        if (!cfg?.appId || !cfg?.ssoLoginEndpoint) continue;
        const shape: AppConfig = {
          appId: cfg.appId,
          appName: cfg.appName || cfg.appId,
          ssoLoginEndpoint: cfg.ssoLoginEndpoint,
          defaultPostLoginRoute: cfg.defaultPostLoginRoute || '/dashboard',
          backendApiUrl: cfg.backendApiUrl || '',
          allowedReturnUrls: Array.isArray(cfg.allowedReturnUrls) ? cfg.allowedReturnUrls : []
        };
        await firstValueFrom(this.svc.create(shape));
        imported++;
      }
      alert(`Imported ${imported} application(s).`);
      await this.load();
    } catch (e: any) {
      this.error = e?.message || 'Import failed.';
    } finally {
      (event.target as HTMLInputElement).value = '';
    }
  }

  trackById(_: number, c: AppConfig) {
    return c.appId;
  }
}
