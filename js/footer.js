/* ==========================================================================
   <site-footer> — shared footer Web Component.
   Renders the brand line, a "book a call" CTA, the phone number, social links,
   and the author/copyright credit from content/footer.json (light DOM, so
   css/footer.css styles it). It sits after <main>, in the normal page flow, so
   it's reached by scrolling past the last fold (Contact).

   The CTA reuses the nav contract: a real href (/contact-us) for no-JS / deep
   links, plus a click that dispatches 'fold:goto' so the fold controller
   smooth-scrolls up to the Contact fold without a reload.
   ========================================================================== */

class SiteFooter extends HTMLElement {
  connectedCallback() {
    this._render();
  }

  async _render() {
    let data;
    try {
      data = await fetch('/content/footer.json').then((r) => r.json());
    } catch (err) {
      console.error('[site-footer] failed to load footer.json', err);
      return;
    }

    const { brand, cta, phone, social = [], author, copyright } = data;

    this.innerHTML = `
      <footer class="site-footer" aria-label="Site footer">
        <div class="site-footer__inner">
          <div class="site-footer__brand">
            <p class="site-footer__wordmark">${brand?.wordmark || ''}</p>
            <p class="site-footer__tagline">${brand?.tagline || ''}</p>
          </div>

          <div class="site-footer__connect">
            ${
              cta
                ? `<a class="site-footer__cta" href="${cta.path}" data-goto="${cta.fold}">${cta.label}</a>`
                : ''
            }
            ${
              phone
                ? `<a class="site-footer__phone" href="${phone.href}">${phone.label}</a>`
                : ''
            }
            ${
              social.length
                ? `<ul class="site-footer__social">
                    ${social
                      .map(
                        (s) => `
                      <li>
                        <a class="site-footer__social-link" href="${s.href}" target="_blank" rel="noopener noreferrer">${s.label}</a>
                      </li>`
                      )
                      .join('')}
                  </ul>`
                : ''
            }
          </div>
        </div>

        <div class="site-footer__bar">
          <span class="site-footer__copyright">${copyright || ''}</span>
          ${author ? `<span class="site-footer__author">Crafted by ${author}</span>` : ''}
        </div>
      </footer>
    `;

    // CTA click → request a smooth scroll to the Contact fold (no reload),
    // reusing the same fold:goto contract the nav uses.
    const ctaLink = this.querySelector('[data-goto]');
    if (ctaLink) {
      ctaLink.addEventListener('click', (e) => {
        e.preventDefault();
        document.dispatchEvent(
          new CustomEvent('fold:goto', { detail: { fold: ctaLink.dataset.goto } })
        );
      });
    }
  }
}

customElements.define('site-footer', SiteFooter);
