/* ==========================================================================
   <site-nav> — shared header Web Component.
   Renders the logo block + nav from content/site.json (light DOM, so base.css
   styles it). Clicks request a fold change; it highlights the active fold.

   Cross-component contract (events on `document`):
     · dispatches 'fold:goto'  { detail: { fold } }  — request navigation
     · listens  'fold:change'  { detail: { fold } }  — active fold changed
   The fold controller also mirrors the active fold on <html data-fold="…">,
   which we read on first render to set the initial highlight.
   ========================================================================== */

class SiteNav extends HTMLElement {
  connectedCallback() {
    this._onFoldChange = (e) => this._setActive(e.detail.fold);
    document.addEventListener('fold:change', this._onFoldChange);
    this._render();
  }

  disconnectedCallback() {
    document.removeEventListener('fold:change', this._onFoldChange);
  }

  async _render() {
    let data;
    try {
      data = await fetch('/content/site.json').then((r) => r.json());
    } catch (err) {
      console.error('[site-nav] failed to load site.json', err);
      return;
    }

    const { logo, nav } = data;

    this.innerHTML = `
      <a class="logo" href="${logo.href}" data-goto="home" aria-label="${logo.wordmark} — home">
        <div class="logo__tagline">${logo.tagline}</div>
        <div class="logo__wordmark">${logo.wordmark}</div>
        <div class="logo__est">${logo.established}</div>
      </a>

      <button class="site-nav__toggle" type="button" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>

      <ul class="site-nav__list">
        ${nav
          .map(
            (item) => `
          <li>
            <a class="site-nav__link" href="${item.path}" data-goto="${item.fold}">${item.label}</a>
          </li>`
          )
          .join('')}
      </ul>
    `;

    this._toggle = this.querySelector('.site-nav__toggle');
    this._links = [...this.querySelectorAll('[data-goto]')];

    // Nav / logo clicks → request a fold change (no reload).
    this.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-goto]');
      if (trigger) {
        e.preventDefault();
        this._closeMenu();
        document.dispatchEvent(
          new CustomEvent('fold:goto', { detail: { fold: trigger.dataset.goto } })
        );
        return;
      }
      if (e.target.closest('.site-nav__toggle')) {
        this._toggleMenu();
      }
    });

    // Initial highlight from the controller's mirrored state (if already set).
    this._setActive(document.documentElement.dataset.fold);

    // Dev tooling for the nav (only under ?dev): the shared drag + editor cores
    // plus the fold-independent site config (registers devConfigs.site + a "NAV"
    // toggle). Deduped against the fold renderers' loads via _devLoaded; the cores
    // are guarded singletons, so a double-load is a no-op. Injected after render so
    // <site-nav>'s DOM exists for the editor to target.
    if (new URLSearchParams(location.search).has('dev')) {
      const NS = (window.MemoryParlour = window.MemoryParlour || {});
      const loaded = (NS._devLoaded = NS._devLoaded || new Set());
      for (const src of ['/js/dev/dev-drag.js', '/js/dev/dev-editor.js', '/js/dev/dev-config.site.js']) {
        if (loaded.has(src)) continue;
        loaded.add(src);
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        document.body.appendChild(s);
      }
    }
  }

  _setActive(fold) {
    if (!this._links) return;
    for (const link of this._links) {
      if (!link.classList.contains('site-nav__link')) continue;
      link.classList.toggle('is-active', link.dataset.goto === fold);
    }
  }

  _toggleMenu() {
    const open = this.classList.toggle('is-open');
    this._toggle?.setAttribute('aria-expanded', String(open));
  }

  _closeMenu() {
    this.classList.remove('is-open');
    this._toggle?.setAttribute('aria-expanded', 'false');
  }
}

customElements.define('site-nav', SiteNav);
