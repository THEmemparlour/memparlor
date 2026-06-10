/* ==========================================================================
   Dev tooling config for the Services fold (loaded ONLY under ?dev, before the
   generic dev-picker/dev-editor cores). Registers window.MemoryParlour.devConfigs.services.

   Image: the FAQ-style 'object' focal crop (always fills the contained portrait
   box; position pans the focal point, zoom ≥ cover tightens).

   Text: heading + body both live in services.json. The body is a `services`
   array of { label, description } entries, rendered to flat <h2>/<p> siblings of
   `.services__list` (styled via the descendant selectors `.services__list h2|p`).
   So the editor selects those by tag (selectorFor), edits them inline, treats an
   <h2>+following<p> as one service for structure ops, and scrape() pairs them
   back into the `services` array — the server writes it all to services.json.
   ========================================================================== */

(() => {
  'use strict';
  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  const configs = (NS.devConfigs = NS.devConfigs || {});

  const listEl = () => document.querySelector('[data-services-body]');

  // Build a service as a flat [<h2> label, <p> description] pair (no wrapper, so
  // the `.services__list h2:first-child` margin reset keeps working).
  const buildService = (label, description) => {
    const h = document.createElement('h2');
    h.textContent = label;
    const p = document.createElement('p');
    p.textContent = description;
    return [h, p];
  };

  // Resolve a selected element to its service: the <h2> label and the optional
  // following <p> description.
  const serviceOf = (el, list) => {
    if (!el || !list.contains(el)) return null;
    if (el.tagName === 'H2') {
      const next = el.nextElementSibling;
      return { label: el, desc: next && next.tagName === 'P' ? next : null };
    }
    if (el.tagName === 'P') {
      const prev = el.previousElementSibling;
      return { label: prev && prev.tagName === 'H2' ? prev : null, desc: el };
    }
    return null;
  };

  const nodesOf = (svc) => (svc.desc ? [svc.label, svc.desc] : [svc.label]);
  // Move a service's nodes (in order) to sit immediately before `ref`.
  const moveNodesBefore = (nodes, ref) => {
    for (const n of nodes) ref.parentElement.insertBefore(n, ref);
  };

  configs.services = {
    id: 'services',
    layout: { selectors: ['.services__heading', '.services__list'], breakpoint: 'desktop', liveStyleId: 'services-dev-layout' },
    image: {
      selector: '[data-services-media] .services__media-el',
      mode: 'object', // focal crop — always fills the box, no gaps (like FAQ/About)
      minZoom: 1, // never below cover
    },
    media: { selector: '[data-services-media] .services__media-el', kind: 'image' },
    editor: {
      rootSelector: '[data-services-root]',
      selectSelectors: '.services__eyebrow, .services__title, [data-services-body] h2, [data-services-body] p',
      cssSelectors: ['.fold-eyebrow', '.fold-title', '.services__list h2', '.services__list p'],
      liveStyleId: 'services-dev-overrides',

      // Tag/context-aware selector resolution (the list blocks carry no class).
      // Eyebrow/title map to the shared cross-fold heading rule (css/folds/headings.css).
      selectorFor(el) {
        if (el.classList.contains('services__eyebrow')) return '.fold-eyebrow';
        if (el.classList.contains('services__title')) return '.fold-title';
        if (el.closest('[data-services-body]')) {
          if (el.tagName === 'H2') return '.services__list h2';
          if (el.tagName === 'P') return '.services__list p';
        }
        return null;
      },

      scrape() {
        const headingEl = document.querySelector('[data-services-heading]');
        const heading = {
          eyebrow: (headingEl?.querySelector('.services__eyebrow')?.textContent || '').trim(),
          title: (headingEl?.querySelector('.services__title')?.textContent || '').trim(),
        };
        // Pair each <h2> label with the first <p> that follows it into one
        // { label, description } service; the renderer reproduces this layout.
        const services = [];
        let current = null;
        for (const node of listEl().children) {
          if (node.tagName === 'H2') {
            current = { label: node.textContent.trim(), description: '' };
            services.push(current);
          } else if (node.tagName === 'P' && current && !current.description) {
            current.description = node.textContent.trim();
          }
        }
        return { fold: 'services', heading, services };
      },

      renderStructure(api) {
        const list = listEl();
        const svc = serviceOf(api.selected, list);

        if (svc && svc.label) {
          api.group('Service', [
            ['↑', 'Move service up', () => {
              const prevEnd = svc.label.previousElementSibling;
              if (!prevEnd) return;
              const prev = serviceOf(prevEnd, list);
              moveNodesBefore(nodesOf(svc), prev.label || prevEnd);
              api.refresh();
            }],
            ['↓', 'Move service down', () => {
              const last = svc.desc || svc.label;
              const nextStart = last.nextElementSibling;
              if (!nextStart) return;
              // Swap by moving the NEXT service ahead of this one's label.
              moveNodesBefore(nodesOf(serviceOf(nextStart, list)), svc.label);
              api.refresh();
            }],
            ['＋', 'Add service after', () => {
              const [h, p] = buildService('New service:', 'New description.');
              const ref = svc.desc || svc.label;
              api.insertAfter(p, ref);
              api.insertAfter(h, ref); // lands between ref and p → ref, h, p
              api.select(h);
              api.enterEdit(h);
            }],
            ['✕', 'Delete service', () => {
              if (list.querySelectorAll('h2').length <= 1) return;
              if (api.selected === svc.label || api.selected === svc.desc) api.clearSelection();
              svc.label.remove();
              if (svc.desc) svc.desc.remove();
              api.refresh();
            }],
          ]);
        }

        api.group('List', [
          ['＋ service', 'Add service at end', () => {
            const [h, p] = buildService('New service:', 'New description.');
            list.append(h, p);
            api.select(h);
            api.enterEdit(h);
          }],
        ]);
      },
    },
  };

  // Config registered + DOM rendered → let the controller mount/rebuild for this fold.
  document.dispatchEvent(new CustomEvent('dev:rendered', { detail: { fold: 'services' } }));
})();
