import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { HttpClient } from '@angular/common/http';

export interface LoginActivity {
  id: number;
  ts: string;
  appId: string | null;
  appName: string | null;
  username: string | null;
  email: string | null;
  company: string | null;
  ip: string | null;
  userAgent: string | null;
  status: string;
  error: string | null;
}

@Component({
  selector: 'app-activities',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './activities.html',
  styleUrls: ['./activities.css']
})
export class ActivitiesComponent implements OnInit {
  activities = signal<LoginActivity[]>([]);
  loading = true;
  error = '';
  searchQuery = '';
  statusFilter = '';
  appIdFilter = '';

  filtered = computed(() => {
    const q = this.searchQuery.trim().toLowerCase();
    const s = this.statusFilter;
    const a = this.appIdFilter;
    return this.activities().filter((r) => {
      if (s && r.status !== s) return false;
      if (a && r.appId !== a) return false;
      if (!q) return true;
      return [r.appId, r.appName, r.username, r.email, r.company, r.ip, r.status]
        .some((v) => (v || '').toString().toLowerCase().includes(q));
    });
  });

  get uniqueApps(): string[] {
    return Array.from(new Set(this.activities().map(a => a.appId).filter((x): x is string => !!x))).sort();
  }
  get statuses(): string[] {
    return Array.from(new Set(this.activities().map(a => a.status))).sort();
  }

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const list = await firstValueFrom(
        this.http.get<LoginActivity[]>('/api/activities', { params: { limit: '500' } }).pipe(timeout(8000))
      );
      this.activities.set(list || []);
    } catch (e: any) {
      this.error = e?.message || 'Failed to load activities.';
    } finally {
      this.loading = false;
    }
  }

  exportJson(): void {
    const blob = new Blob([JSON.stringify(this.filtered(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `login-activities-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  trackById(_: number, r: LoginActivity) { return r.id; }
}
