(function () {
  if (customElements.get('aep-guard')) return;

  const DEFAULTS = { pollForHelper: 50, pollMaxTries: 100 };

  function readMeta(name, fallback) {
    const el = document.querySelector('meta[name="' + name + '"]');
    return (el && el.content) ? el.content : fallback;
  }

  function readSession() {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return { token: null, expiresAt: null };
    }
    const token      = sessionStorage.getItem('aep_token');
    const expiresAt  = sessionStorage.getItem('aep_expires_at');
    let expired = false;
    if (expiresAt) {
      const t = Date.parse(expiresAt);
      if (!Number.isNaN(t) && Date.now() >= t) expired = true;
    }
    if (expired) {
      try {
        sessionStorage.removeItem('aep_token');
        sessionStorage.removeItem('aep_composite');
        sessionStorage.removeItem('aep_expires_at');
      } catch (e) { /* noop */ }
      return { token: null, expiresAt: null };
    }
    return { token, expiresAt };
  }

  function buildSignInUrl(brokerOrigin, loginPath, appId, returnUrl) {
    const base = (brokerOrigin || '').replace(/\/$/, '');
    return base + (loginPath || '/login') +
           '?app=' + encodeURIComponent(appId) +
           '&returnUrl=' + encodeURIComponent(returnUrl);
  }

  class AepGuard extends HTMLElement {
    static get observedAttributes() {
      return ['broker-origin', 'app-id', 'login-path', 'exempt-path-prefix', 'loading-html'];
    }
    constructor() { super(); this._pollHandle = null; this._redirecting = false; }
    connectedCallback() {
      const cfg = this._config();
      const path = (typeof window !== 'undefined') ? window.location.pathname : '/';
      if (cfg.exemptPathPrefix && path.indexOf(cfg.exemptPathPrefix) === 0) return;
      this._renderLoading(cfg);
      this._waitForHelper().then(() => this._evaluate(cfg));
    }
    disconnectedCallback() { if (this._pollHandle) clearTimeout(this._pollHandle); }
    attributeChangedCallback() { }
    _config() {
      return {
        brokerOrigin:      this.getAttribute('broker-origin')      || readMeta('aep-broker', 'http://localhost:4200'),
        appId:             this.getAttribute('app-id')             || readMeta('aep-app',    'my-app'),
        loginPath:         this.getAttribute('login-path')         || '/login',
        exemptPathPrefix:  this.getAttribute('exempt-path-prefix') || '',
        loadingHtml:       this.getAttribute('loading-html')       || ''
      };
    }
    _waitForHelper() {
      if (typeof window === 'undefined') return Promise.resolve();
      if (window.AepAuth) return Promise.resolve();
      return new Promise((resolve) => {
        let tries = 0;
        const tick = () => {
          if (window.AepAuth) { resolve(); return; }
          if (++tries > DEFAULTS.pollMaxTries) { resolve(); return; }
          this._pollHandle = setTimeout(tick, DEFAULTS.pollForHelper);
        };
        tick();
      });
    }
    _evaluate(cfg) {
      if (this._redirecting) return;
      // Make sure a ?token=… still sitting in the URL is captured into
      // sessionStorage before we decide whether to redirect (the helper only
      // parses the URL when asked).
      if (window.AepAuth && typeof window.AepAuth.getToken === 'function') {
        try { window.AepAuth.getToken(); } catch (_) { /* noop */ }
      }
      const session = readSession();
      if (session.token) {
        this._renderNothing();
        this.dispatchEvent(new CustomEvent('aep-guard-ok', { bubbles: true, detail: { appId: cfg.appId, expiresAt: session.expiresAt } }));
        return;
      }
      this._redirect(cfg);
    }
    _redirect(cfg) {
      if (this._redirecting) return;
      this._redirecting = true;
      if (typeof window === 'undefined') return;
      const returnUrl = window.location.origin + window.location.pathname +
                        (window.location.search || '') + (window.location.hash || '');
      const url = buildSignInUrl(cfg.brokerOrigin, cfg.loginPath, cfg.appId, returnUrl);
      this.dispatchEvent(new CustomEvent('aep-guard-redirecting', { bubbles: true, detail: { to: url, appId: cfg.appId } }));
      window.location.replace(url);
    }
    _renderLoading(cfg) {
      const loading = cfg.loadingHtml || '<div style="font-family:system-ui,sans-serif;color:#6b7280;padding:24px;">Signing in…</div>';
      this.innerHTML = loading;
    }
    _renderNothing() { this.innerHTML = ''; }
  }

  if (typeof customElements !== 'undefined') {
    customElements.define('aep-guard', AepGuard);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      if (window.customElements && !window.customElements.get('aep-guard')) {
        window.customElements.define('aep-guard', AepGuard);
      }
    });
  }
})();
