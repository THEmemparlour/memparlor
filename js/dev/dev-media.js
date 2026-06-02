/* ==========================================================================
   Dev-only media manager — GENERIC core (loaded ONLY under ?dev).
   Registers window.MemoryParlour.buildMedia(cfg), driven by a fold's
   devConfigs[fold].media: { selector, kind: 'image'|'video' }.

   Lets the dev replace a fold's media source without leaving the browser:
     · pick a file → POST /__dev/upload streams it to Cloudflare R2 and returns
       the public custom-domain URL (the dev server holds the R2 creds);
     · or paste a URL directly into the source field;
   then Apply previews it live on the existing element (re-using whatever crop the
   ?dev picker has set, since we only swap src/poster — no re-render), and Save
   POSTs /__dev/media to write media.{src,alt?,poster?} into content/<fold>.json.

   The dev controller calls buildMedia on fold-enter and destroy() on fold-leave,
   so exactly one media panel exists at a time and it matches the active fold.
   ========================================================================== */

(() => {
  'use strict';

  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.buildMedia) return; // define the builder once (every fold re-injects this core)

  NS.buildMedia = (cfg) => {
    if (!cfg || !cfg.media) return null;

    const foldId = cfg.id;
    const { selector, kind = 'image' } = cfg.media;
    const isVideo = kind === 'video';
    const el = document.querySelector(selector);
    if (!el) {
      console.warn(`[dev-media] element (${selector}) not found for fold "${foldId}"`);
      return null;
    }

    const devKey = () => NS.devAuth?.key?.() || '';
    let dirty = false; // true once a field changes or an upload completes; gates master save

    // --- Panel scaffolding (mirrors the other dev cores) -----------------------
    const panel = document.createElement('div');
    panel.setAttribute('data-mp-dev', '');
    Object.assign(panel.style, {
      position: 'fixed', top: '334px', left: '16px', zIndex: '9999', width: '244px',
      font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
      background: 'rgba(20,19,16,0.92)', color: '#f7f5e7', padding: '10px',
      borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px', userSelect: 'none',
    });
    const title = document.createElement('div');
    title.textContent = `${foldId.toUpperCase()} MEDIA`;
    title.style.cssText = 'opacity:.6;letter-spacing:.08em;';

    const status = document.createElement('div');
    status.style.cssText = 'opacity:.7;min-height:1.2em;';
    status.textContent = isVideo ? 'video — upload or paste a URL' : 'image — upload or paste a URL';
    const setStatus = (t) => { status.textContent = t; };

    // Labelled text input.
    const mkField = (labelText, value) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
      const lab = document.createElement('span');
      lab.textContent = labelText;
      lab.style.cssText = 'opacity:.7;';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value || '';
      Object.assign(input.style, {
        font: 'inherit', color: '#f7f5e7', background: 'rgba(247,245,231,0.1)',
        border: '1px solid rgba(247,245,231,0.25)', borderRadius: '4px', padding: '3px 4px', minWidth: '0',
      });
      wrap.append(lab, input);
      return { wrap, input };
    };

    // File picker that uploads to R2 and feeds the resulting URL to `onUrl`.
    const mkUpload = (labelText, accept, onUrl) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
      const lab = document.createElement('span');
      lab.textContent = labelText;
      lab.style.cssText = 'opacity:.7;';
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.cssText = 'font:inherit;color:#f7f5e7;';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        setStatus(`Uploading ${file.name}…`);
        try {
          const res = await fetch('/__dev/upload', {
            method: 'POST',
            headers: {
              'X-Dev-Key': devKey(),
              'X-Media-Fold': foldId,
              // Header values must be Latin-1; encode so non-Latin-1 names (CJK,
              // emoji) don't throw and abort the upload. The server slugifies anyway.
              'X-File-Name': encodeURIComponent(file.name),
              'Content-Type': file.type,
            },
            body: file,
          });
          if (!res.ok) {
            const msg = await res.text().catch(() => '');
            setStatus(`Upload failed (${res.status}) ${msg}`.trim());
            return;
          }
          const { url } = await res.json();
          onUrl(url);
          dirty = true;
          setStatus('Uploaded ✓ — Apply to preview, then Save');
        } catch {
          setStatus('Upload failed (network)');
        } finally {
          input.value = ''; // allow re-picking the same file
        }
      });
      wrap.append(lab, input);
      return wrap;
    };

    // --- Fields ----------------------------------------------------------------
    const srcField = mkField('Source URL', el.getAttribute('src') || '');
    const srcUpload = mkUpload(isVideo ? 'Upload video' : 'Upload image',
      isVideo ? 'video/mp4,video/webm' : 'image/*',
      (url) => { srcField.input.value = url; });

    let altField = null;
    let posterField = null;
    let posterUpload = null;
    if (isVideo) {
      posterField = mkField('Poster URL', el.getAttribute('poster') || '');
      posterUpload = mkUpload('Upload poster', 'image/*', (url) => { posterField.input.value = url; });
    } else {
      altField = mkField('Alt text', el.getAttribute('alt') || '');
    }

    // Manual typing into any field is a pending change too (uploads set `dirty`
    // in mkUpload, since assigning input.value programmatically doesn't fire 'input').
    for (const f of [srcField, altField, posterField]) {
      if (f) f.input.addEventListener('input', () => { dirty = true; });
    }

    // --- Apply live (no re-render: swap attributes on the existing element) -----
    const applyLive = () => {
      const src = srcField.input.value.trim();
      if (isVideo) {
        if (posterField) {
          const poster = posterField.input.value.trim();
          if (poster) el.poster = poster;
        }
        if (src) { el.src = src; el.load?.(); }
      } else {
        if (src) el.src = src;
        if (altField) el.alt = altField.input.value;
      }
      setStatus('Applied (not saved)');
    };

    // --- Buttons ---------------------------------------------------------------
    const mkBtn = (text, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      Object.assign(b.style, {
        font: 'inherit', cursor: 'pointer', color: '#f7f5e7', marginTop: '2px',
        background: 'rgba(247,245,231,0.15)', border: '1px solid rgba(247,245,231,0.3)',
        borderRadius: '4px', padding: '5px 0',
      });
      b.addEventListener('click', onClick);
      return b;
    };

    const applyBtn = mkBtn('Apply', applyLive);
    const saveBtn = mkBtn('Save media', async () => {
      const src = srcField.input.value.trim();
      if (!src) { setStatus('Source URL is required'); return; }
      saveBtn.textContent = 'Saving…';
      const payload = { fold: foldId, src };
      if (isVideo) {
        if (posterField && posterField.input.value.trim()) payload.poster = posterField.input.value.trim();
      } else if (altField) {
        payload.alt = altField.input.value;
      }
      try {
        const res = await fetch('/__dev/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Dev-Key': devKey() },
          body: JSON.stringify(payload),
        });
        saveBtn.textContent = res.ok ? 'Saved ✓' : 'Save failed';
      } catch {
        saveBtn.textContent = 'Save failed';
      }
      setTimeout(() => { saveBtn.textContent = 'Save media'; }, 1400);
    });

    // --- Assemble --------------------------------------------------------------
    panel.append(title, status, srcField.wrap, srcUpload);
    if (isVideo) panel.append(posterField.wrap, posterUpload);
    else panel.append(altField.wrap);
    panel.append(applyBtn, saveBtn);

    document.body.appendChild(panel);
    NS.dockPanel?.(panel, 'left'); // stack below the layout panel (measured height → no overlap)
    NS.makeDraggable?.(panel, title); // drag the panel by its title bar

    return {
      // Master-save hook: persist media.{src,alt?|poster?} (same payload as the
      // Save media button), but only if a field changed or a file was uploaded —
      // and never with an empty src (which the server rejects anyway).
      async save() {
        if (!dirty) return [];
        const src = srcField.input.value.trim();
        if (!src) return [{ target: `${foldId} · media`, ok: false }];
        const payload = { fold: foldId, src };
        if (isVideo) {
          if (posterField && posterField.input.value.trim()) payload.poster = posterField.input.value.trim();
        } else if (altField) {
          payload.alt = altField.input.value;
        }
        let ok = false;
        try {
          const res = await fetch('/__dev/media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Dev-Key': devKey() },
            body: JSON.stringify(payload),
          });
          ok = res.ok;
        } catch { ok = false; }
        return [{ target: `${foldId} · media`, ok }];
      },
      destroy() {
        panel.remove();
      },
    };
  };
})();
