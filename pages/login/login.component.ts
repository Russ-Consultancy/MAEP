import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class LoginComponent {
  error = false;
  errorMessage = 'Complete the Ping sign-in flow to access the portal.';
  isLoading = false;
  loading = true;
  appId = '';
  appName = '';
  returnUrl = '';

  constructor(
    private auth: AuthService,
    private route: ActivatedRoute
  ) {
    const authError = this.route.snapshot.queryParamMap.get('authError');
    if (authError) {
      this.error = true;
      this.errorMessage = authError;
    }

    this.appId = this.route.snapshot.queryParamMap.get('app') || '';
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '';

    if (!this.appId) {
      this.loading = false;
      this.error = true;
      this.errorMessage =
        'No application specified. Open this login page with ?app=<appId> (optionally &returnUrl=<url-to-go-back-to>).';
      return;
    }

    this.auth
      .initForApp(this.appId)
      .then((cfg) => {
        this.appName = cfg.appName;
        this.loading = false;
      })
      .catch((err) => {
        this.loading = false;
        this.error = true;
        this.errorMessage = `Could not load application "${this.appId}": ${err?.message || err}`;
      });
  }

  async login() {
    this.error = false;
    this.isLoading = true;

    try {
      await this.auth.login(this.returnUrl || undefined);
    } catch {
      this.error = true;
      this.errorMessage = 'Unable to start Ping sign-in. Verify the OIDC settings for this application.';
      this.isLoading = false;
    }
  }
}
