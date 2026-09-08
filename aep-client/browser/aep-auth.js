(function () {
  const meta = (n) => document.querySelector('meta[name="' + n + '"]')?.content;
  const BROKER = meta('aep-broker') || 'http://localhost:4200';
  const APP_ID = meta('aep-app')    || 'my-app';
  const TOKEN_KEY = 'aep_token';
  const COMPOSITE_KEY = 'aep_composite';
  const EXPIRES_KEY = 'aep_expires_at';

  function clear() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(COMPOSITE_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
    try { window.dispatchEvent(new Event('aep-auth-changed')); } catch (_) {}
  }

  function isExpired() {
    const exp = sessionStorage.getItem(EXPIRES_KEY);
    if (!exp) return false;
    return Date.now() >= new Date(exp).getTime();
  }

  function readTokens() {
    const params = new URLSearchParams(location.search);
    const t = params.get('token');
    const c = params.get('compositeToken');
    const e = params.get('expires_at') || params.get('expiresAt');
    if (t) { sessionStorage.setItem(TOKEN_KEY, t); params.delete('token'); }
    if (c) { sessionStorage.setItem(COMPOSITE_KEY, c); params.delete('compositeToken'); }
    if (e) { sessionStorage.setItem(EXPIRES_KEY, e); params.delete('expires_at'); params.delete('expiresAt'); }
    if (t || c || e) {
      const qs = params.toString();
      history.replaceState({}, '', location.pathname + (qs ? '?' + qs : ''));
      try { window.dispatchEvent(new Event('aep-auth-changed')); } catch (_) {}
    }
    if (isExpired()) { clear(); return { token: null, compositeToken: null, expiresAt: null }; }
    return {
      token: sessionStorage.getItem(TOKEN_KEY),
      compositeToken: sessionStorage.getItem(COMPOSITE_KEY),
      expiresAt: sessionStorage.getItem(EXPIRES_KEY)
    };
  }

  window.AepAuth = {
    getToken: () => readTokens().token,
    getCompositeToken: () => readTokens().compositeToken,
    getExpiresAt: () => readTokens().expiresAt,
    signInWithBroker(returnUrl) {
      const ret = returnUrl || (location.origin + location.pathname);
      location.href = BROKER + '/login?app=' + encodeURIComponent(APP_ID) + '&returnUrl=' + encodeURIComponent(ret);
    },
    signOut() { clear(); location.reload(); },
    requireAuth() {
      if (!readTokens().token) {
        this.signInWithBroker(location.origin + location.pathname);
        return false;
      }
      return true;
    }
  };
})();
