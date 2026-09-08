(function () {
  if (customElements.get('aep-signin')) return;

  const DEFAULTS = {
    brokerOrigin: 'http://localhost:4200', appId: 'my-app', returnPath: '/',
    label: 'Sign in with SSO', signOutLabel: 'Sign out',
    autoRedirect: false, showToken: false, theme: 'light',
    pollForHelper: 50, pollMaxTries: 100
  };

  function readMeta(name, fallback) {
    const el = document.querySelector('meta[name="' + name + '"]');
    return (el && el.content) ? el.content : fallback;
  }

  function readSession() {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return { token: null, composite: null, expiresAt: null };
    }
    const token      = sessionStorage.getItem('aep_token');
    const composite  = sessionStorage.getItem('aep_composite');
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
      return { token: null, composite: null, expiresAt: null };
    }
    return { token, composite, expiresAt };
  }

  function resolveReturnUrl(returnPath) {
    if (typeof window === 'undefined') return returnPath;
    if (/^https?:\/\//i.test(returnPath) || returnPath.startsWith('//')) return returnPath;
    return window.location.origin + (returnPath.startsWith('/') ? returnPath : '/' + returnPath);
  }

  function buildSignInUrl(brokerOrigin, appId, returnUrl) {
    return brokerOrigin.replace(/\/$/, '') +
           '/login?app=' + encodeURIComponent(appId) +
           '&returnUrl=' + encodeURIComponent(returnUrl);
  }

  function styles(theme) {
    const dark = theme === 'dark';
    const fg   = dark ? '#f3f4f6' : '#111827';
    const bg   = dark ? '#1f2937' : '#ffffff';
    const bd   = dark ? '#374151' : '#d1d5db';
    const btn  = dark ? '#3b82f6' : '#1e3a8a';
    const btnFg= '#ffffff';
    const muted= dark ? '#9ca3af' : '#6b7280';
    return [
      ':host{display:block;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}',
      '.card{border:1px solid ' + bd + ';border-radius:8px;padding:16px;background:' + bg + ';color:' + fg + ';}',
      '.row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}',
      'h2{margin:0 0 4px 0;font-size:1.1rem;}',
      'p{margin:0 0 8px 0;}',
      'code.mono{display:block;word-break:break-all;background:' + (dark ? '#111827' : '#f4f4f4') + ';color:' + fg + ';padding:8px;border-radius:4px;font-size:0.8rem;margin:4px 0;}',
      '.muted{color:' + muted + ';font-size:0.85rem;}',
      'button{background:' + btn + ';color:' + btnFg + ';border:0;border-radius:6px;padding:8px 14px;cursor:pointer;font:inherit;font-weight:600;}',
      'button.ghost{background:transparent;color:' + fg + ';border:1px solid ' + bd + ';}',
      'button:disabled{opacity:0.6;cursor:not-allowed;}',
      '.label{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em;color:' + muted + ';margin-top:8px;}'
    ].join('');
  }

  class AepSignin extends HTMLElement {
    static get observedAttributes() {
      return ['return-path', 'auto-redirect', 'show-token', 'theme', 'label', 'sign-out-label', 'broker-origin', 'app-id'];
    }
    constructor() {
      super();
      this._state = { token: null, composite: null, expiresAt: null, hasHelper: false, error: null };
      this._pollHandle = null;
      this._storageHandler = () => this.refresh();
      this.attachShadow({ mode: 'open' });
    }
    connectedCallback() {
      this._waitForHelper().then(() => this._render());
      window.addEventListener('storage', this._storageHandler);
      window.addEventListener('aep-auth-changed', this._storageHandler);
    }
    disconnectedCallback() {
      window.removeEventListener('storage', this._storageHandler);
      window.removeEventListener('aep-auth-changed', this._storageHandler);
      if (this._pollHandle) clearTimeout(this._pollHandle);
    }
    attributeChangedCallback() { this._render(); }
    _config() {
      const bool = (v, d) => v === null ? d : v !== 'false' && v !== '0' && v !== '';
      return {
        brokerOrigin: this.getAttribute('broker-origin') || readMeta('aep-broker', DEFAULTS.brokerOrigin),
        appId:        this.getAttribute('app-id')        || readMeta('aep-app',    DEFAULTS.appId),
        returnPath:   this.getAttribute('return-path')   || DEFAULTS.returnPath,
        label:        this.getAttribute('label')          || DEFAULTS.label,
        signOutLabel: this.getAttribute('sign-out-label')|| DEFAULTS.signOutLabel,
        autoRedirect: bool(this.getAttribute('auto-redirect'), DEFAULTS.autoRedirect),
        showToken:    bool(this.getAttribute('show-token'),    DEFAULTS.showToken),
        theme:        this.getAttribute('theme')         || DEFAULTS.theme
      };
    }
    _waitForHelper() {
      if (typeof window === 'undefined') return Promise.resolve();
      if (window.AepAuth) { this._state.hasHelper = true; return Promise.resolve(); }
      return new Promise((resolve) => {
        let tries = 0;
        const tick = () => {
          if (window.AepAuth) { this._state.hasHelper = true; resolve(); return; }
          if (++tries > DEFAULTS.pollMaxTries) { resolve(); return; }
          this._pollHandle = setTimeout(tick, DEFAULTS.pollForHelper);
        };
        tick();
      });
    }
    _dispatchChange() { try { window.dispatchEvent(new Event('aep-auth-changed')); } catch (e) { /* noop */ } }
    refresh() { this._state = Object.assign({}, this._state, readSession()); this._render(); }
    _onSignIn() {
      const cfg = this._config();
      const returnUrl = resolveReturnUrl(cfg.returnPath);
      const url = buildSignInUrl(cfg.brokerOrigin, cfg.appId, returnUrl);
      if (typeof window !== 'undefined') window.location.href = url;
    }
    _onSignOut() {
      if (window.AepAuth && typeof window.AepAuth.signOut === 'function') { window.AepAuth.signOut(); return; }
      try {
        sessionStorage.removeItem('aep_token');
        sessionStorage.removeItem('aep_composite');
        sessionStorage.removeItem('aep_expires_at');
      } catch (e) { /* noop */ }
      this._dispatchChange();
      this.refresh();
    }
    _render() {
      const cfg = this._config();
      this._state = Object.assign({}, this._state, readSession());
      const { token, composite, expiresAt, hasHelper } = this._state;
      if (!hasHelper) {
        this._renderMessage('MAEP / aep-auth.js not detected',
          'Add <script src="' + (cfg.brokerOrigin + '/aep-auth.js') + '"></script> to your <head> and the meta tags ' +
          '<meta name="aep-broker"> and <meta name="aep-app">.');
        return;
      }
      if (token) { this._renderSignedIn(cfg, token, composite, expiresAt); return; }
      this._renderSignedOut(cfg);
    }
    _renderSignedOut(cfg) {
      const style = '<style>' + styles(cfg.theme) + '</style>';
      this.shadowRoot.innerHTML = style + `
        <div class="card">
          <h2>${escapeHtml(cfg.label)}</h2>
          <p class="muted">You are not signed in.</p>
          <button id="btn">${escapeHtml(cfg.label)}</button>
        </div>
      `;
      this.shadowRoot.getElementById('btn').addEventListener('click', () => this._onSignIn());
    }
    _renderSignedIn(cfg, token, composite, expiresAt) {
      const style = '<style>' + styles(cfg.theme) + '</style>';
      const tokenBlock = cfg.showToken ? `
        <div class="label">JWT</div>
        <code class="mono">${escapeHtml(token)}</code>
        <div class="label">Composite token</div>
        <code class="mono">${escapeHtml(composite || '')}</code>
        <div class="label">Expires at</div>
        <code class="mono">${escapeHtml(expiresAt || '—')}</code>
      ` : '';
      this.shadowRoot.innerHTML = style + `
        <div class="card">
          <div class="row">
            <div>
              <h2>Signed in</h2>
              <p class="muted">App: ${escapeHtml(cfg.appId)}${expiresAt ? ' · expires ' + escapeHtml(expiresAt) : ''}</p>
            </div>
            <button class="ghost" id="out">${escapeHtml(cfg.signOutLabel)}</button>
          </div>
          ${tokenBlock}
        </div>
      `;
      this.shadowRoot.getElementById('out').addEventListener('click', () => this._onSignOut());
    }
    _renderMessage(title, body) {
      const style = '<style>' + styles(this._config().theme) + '</style>';
      this.shadowRoot.innerHTML = style + `
        <div class="card">
          <h2>${escapeHtml(title)}</h2>
          <p class="muted">${escapeHtml(body)}</p>
        </div>
      `;
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  if (typeof customElements !== 'undefined') {
    customElements.define('aep-signin', AepSignin);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      if (window.customElements && !window.customElements.get('aep-signin')) {
        window.customElements.define('aep-signin', AepSignin);
      }
    });
  }
})();
