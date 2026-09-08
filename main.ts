import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideOAuthClient } from 'angular-oauth2-oidc';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { tokenInterceptor } from './token.interceptor';

async function main() {
  await bootstrapApplication(AppComponent, {
    providers: [
      provideRouter(routes),
      provideOAuthClient(),
      provideHttpClient(withInterceptors([tokenInterceptor]))
    ]
  });
}

main();
