/* ==========================================================================
   Dev-only passphrase gate (loaded ONLY under ?dev, before the other dev cores).
   Registers window.MemoryParlour.devAuth and runs the unlock flow on load.

   The client never holds the real secret: on unlock it sends the typed phrase to
   the dev server's POST /__dev/auth, which compares it to MP_DEV_KEY and answers
   yes/no. On success the phrase is kept in sessionStorage (survives fold nav +
   reloads in this tab; forgotten when the tab closes) and re-sent as the
   `X-Dev-Key` header on every Save. The panels are mounted by dev-controller.js,
   which waits for the `dev:unlocked` event — so nothing appears until we unlock.

   Production has no /__dev/* server, so validate() returns 'no-server' and we stay
   silently locked (no prompt, no panels). A wrong/cancelled phrase dispatches
   `dev:locked`, which tears down the dev UI (controller's SAVE ALL button, the
   nav toggle, the shell panel).
   ========================================================================== */

(() => {
  'use strict';

  const NS = (window.MemoryParlour = window.MemoryParlour || {});
  if (NS.devAuth) return; // guarded singleton (every fold re-injects this core)

  const STORE_KEY = 'mp:devkey';
  const MAX_TRIES = 3;
  const read = () => {
    try { return sessionStorage.getItem(STORE_KEY) || ''; } catch { return ''; }
  };

  NS.devAuth = {
    key: read,
    isUnlocked: () => !!NS.devUnlocked,
    lock() {
      try { sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      NS.devUnlocked = false;
      document.dispatchEvent(new CustomEvent('dev:locked'));
    },
  };

  // Ask the server whether `key` is valid. Returns:
  //   true        — accepted
  //   false       — wrong key (a key IS configured)
  //   'disabled'  — no key configured server-side → dev is off (403)
  //   'no-server' — network error / 404 → no dev server here (e.g. production)
  // The last two mean "stay locked without prompting".
  const validate = async (key) => {
    let res;
    try {
      res = await fetch('/__dev/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
    } catch {
      return 'no-server'; // network error → no dev server
    }
    if (res.status === 404) return 'no-server';
    if (res.status === 403) return 'disabled'; // MP_DEV_KEY unset → tools disabled
    if (!res.ok) return false; // 401 → wrong key
    const data = await res.json().catch(() => ({}));
    return !!data.ok;
  };

  const unlock = (key) => {
    try { sessionStorage.setItem(STORE_KEY, key); } catch { /* ignore storage failures */ }
    NS.devUnlocked = true;
    document.dispatchEvent(new CustomEvent('dev:unlocked'));
  };

  const giveUp = () => {
    NS.devUnlocked = false;
    document.dispatchEvent(new CustomEvent('dev:locked'));
  };

  (async () => {
    // 1) A key from earlier in this tab? (covers reloads + cross-fold navigation.)
    const stored = read();
    if (stored && (await validate(stored)) === true) return unlock(stored);

    // 2) Probe: detect "disabled" (no MP_DEV_KEY) or "no server" (production) so we
    //    stay locked silently — no prompt — in those cases.
    const probe = await validate('');
    if (probe === 'disabled' || probe === 'no-server') return giveUp();

    // 3) A key is configured — prompt for the passphrase.
    for (let i = 0; i < MAX_TRIES; i++) {
      const entry = window.prompt('Enter the dev passphrase:');
      if (entry == null) break; // cancelled
      if ((await validate(entry)) === true) return unlock(entry);
    }
    giveUp();
  })();
})();
