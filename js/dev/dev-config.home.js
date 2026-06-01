/* ==========================================================================
   Dev tooling config for the Home fold (loaded ONLY under ?dev, before the
   generic dev-picker/dev-editor cores). Registers window.MemoryParlour.devConfigs.home.

   The image is a full-fold backdrop, so it uses the 'transform' crop mode
   (translate + scale; the base may show when zoomed out) — unlike FAQ's 'object'
   focal crop. The text differs too: the headline is an array of styled segments
   (upright/italic) + line breaks, so the editor adapter works in segments and
   keeps the renderer's spacing/break invariant via normalizeHeadline.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  const configs = (NS.devConfigs = NS.devConfigs || {});

  const headline = () => document.querySelector('[data-home-headline]');

  const buildSeg = (text, style) => {
    const s = document.createElement('span');
    s.className = `home__seg home__seg--${style === 'italic' ? 'italic' : 'upright'}`;
    s.textContent = text;
    return s;
  };

  // Reproduce js/home.js renderHeadline's separators: a single space between two
  // adjacent segment spans on the same line, and none across a <br>. Run after
  // every structural change so scrape→save→reload is a no-op.
  const normalizeHeadline = (el) => {
    [...el.childNodes].forEach((n) => { if (n.nodeType === 3) el.removeChild(n); });
    const kids = [...el.childNodes];
    for (let i = 0; i < kids.length - 1; i++) {
      const a = kids[i];
      const b = kids[i + 1];
      const aSeg = a.nodeType === 1 && a.classList.contains('home__seg');
      const bSeg = b.nodeType === 1 && b.classList.contains('home__seg');
      if (aSeg && bSeg) el.insertBefore(document.createTextNode(' '), b);
    }
  };

  configs.home = {
    id: 'home',
    layout: { selectors: ['.home__headline'], breakpoint: 'desktop', liveStyleId: 'home-dev-layout' },
    image: {
      selector: '[data-home-media] .home__media-el',
      mode: 'transform', // movable backdrop — translate + scale, base may show
      minZoom: 0.2,
    },
    editor: {
      rootSelector: '[data-home-root]',
      selectSelectors: '.home__seg, .home__headline',
      editSelectors: '.home__seg',
      classFor: {
        'home__seg--italic': '.home__seg--italic',
        'home__seg--upright': '.home__seg--upright',
        'home__headline': '.home__headline',
      },
      cssSelectors: ['.home__headline', '.home__seg--upright', '.home__seg--italic'],
      liveStyleId: 'home-dev-overrides',

      scrape() {
        const el = headline();
        const out = [];
        el.childNodes.forEach((node) => {
          if (node.nodeType === 1 && node.tagName === 'BR') out.push({ break: true });
          else if (node.nodeType === 1 && node.classList.contains('home__seg')) {
            const text = node.textContent.trim();
            if (text) {
              out.push({ text, style: node.classList.contains('home__seg--italic') ? 'italic' : 'upright' });
            }
          }
        });
        return { fold: 'home', headline: out };
      },

      renderStructure(api) {
        const el = headline();
        const sel = api.selected;
        const seg = sel && sel.classList.contains('home__seg') ? sel : null;

        if (seg) {
          const isItalic = seg.classList.contains('home__seg--italic');
          const breakAfter = seg.nextElementSibling && seg.nextElementSibling.tagName === 'BR';
          api.group('Segment', [
            ['↑', 'Move earlier', () => { api.reorder(seg, -1); normalizeHeadline(el); api.refresh(); }],
            ['↓', 'Move later', () => { api.reorder(seg, 1); normalizeHeadline(el); api.refresh(); }],
            [isItalic ? '→ upright' : '→ italic', 'Toggle italic/upright', () => {
              seg.classList.toggle('home__seg--italic', !isItalic);
              seg.classList.toggle('home__seg--upright', isItalic);
              api.clearSelection();
              api.select(seg); // re-seed the CSS inspector for the new variant class
            }],
            ['＋ seg', 'Add segment after', () => {
              const s = buildSeg('NEW', 'upright');
              api.insertAfter(s, seg);
              normalizeHeadline(el);
              api.select(s);
              api.enterEdit(s);
            }],
            [breakAfter ? '✕ break' : '＋ break', breakAfter ? 'Remove line break after' : 'Add line break after', () => {
              if (breakAfter) seg.nextElementSibling.remove();
              else api.insertAfter(document.createElement('br'), seg);
              normalizeHeadline(el);
              api.refresh();
            }],
            ['✕', 'Delete segment', () => {
              if (el.querySelectorAll('.home__seg').length <= 1) return;
              if (api.selected === seg) api.clearSelection();
              seg.remove();
              normalizeHeadline(el);
              api.refresh();
            }],
          ]);
        }

        api.group('Headline', [
          ['＋ seg', 'Add segment at end', () => {
            const s = buildSeg('NEW', 'upright');
            el.appendChild(s);
            normalizeHeadline(el);
            api.select(s);
            api.enterEdit(s);
          }],
          ['＋ break', 'Add line break at end', () => {
            el.appendChild(document.createElement('br'));
            normalizeHeadline(el);
            api.refresh();
          }],
        ]);
      },
    },
  };

  // Config registered + DOM rendered → let the controller mount/rebuild for this fold.
  document.dispatchEvent(new CustomEvent('dev:rendered', { detail: { fold: 'home' } }));
})();
