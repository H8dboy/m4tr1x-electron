/**
 * M4TR1X — In-App Updater (frontend side)
 *
 * Listens for the Rust "update-available" event emitted by check_update_background()
 * and renders a dismissible banner at the top of the app.
 *
 * When the user clicks "INSTALLA", it calls the check_for_updates Tauri command
 * which downloads + installs the new version, then prompts a restart.
 *
 * Usage: add <script src="updater.js"></script> to index.html (just before </body>)
 */

(function () {
    'use strict';

   // Only run inside Tauri — skip in browser preview mode
   if (!window.__TAURI__) return;

   const { listen } = window.__TAURI__.event;
    const { invoke } = window.__TAURI__.core;

   // ── Banner HTML ─────────────────────────────────────────────────────────────
   function createBanner(version, notes) {
         const banner = document.createElement('div');
         banner.id = 'm4tr1x-update-banner';
         banner.innerHTML = `
               <div class="update-banner-inner">
                       <span class="update-icon">⬆</span>
                               <span class="update-text">
                                         <strong>AGGIORNAMENTO DISPONIBILE</strong> — v${version}
                                                   ${notes ? `<small>${notes.substring(0, 80)}${notes.length > 80 ? '…' : ''}</small>` : ''}
                                                           </span>
                                                                   <button class="update-btn-install" id="m4tr1x-btn-install">INSTALLA</button>
                                                                           <button class="update-btn-dismiss" id="m4tr1x-btn-dismiss" aria-label="Chiudi">✕</button>
                                                                                 </div>
                                                                                     `;

      // ── Inline styles (no external CSS dependency) ───────────────────────────
      Object.assign(banner.style, {
              position:        'fixed',
              top:             '0',
              left:            '0',
              right:           '0',
              zIndex:          '9999',
              background:      'linear-gradient(90deg, #00ff41 0%, #00cc33 100%)',
              color:           '#000',
              fontFamily:      '"Courier New", monospace',
              fontSize:        '13px',
              padding:         '10px 14px',
              display:         'flex',
              alignItems:      'center',
              boxShadow:       '0 2px 8px rgba(0,255,65,0.4)',
              animation:       'slideDown 0.3s ease',
      });

      const inner = banner.querySelector('.update-banner-inner');
         Object.assign(inner.style, {
                 display:     'flex',
                 alignItems:  'center',
                 gap:         '10px',
                 width:       '100%',
                 flexWrap:    'wrap',
         });

      const installBtn = banner.querySelector('#m4tr1x-btn-install');
         Object.assign(installBtn.style, {
                 background:    '#000',
                 color:         '#00ff41',
                 border:        '1px solid #00ff41',
                 padding:       '4px 12px',
                 cursor:        'pointer',
                 fontFamily:    'inherit',
                 fontSize:      '12px',
                 fontWeight:    'bold',
                 letterSpacing: '1px',
                 borderRadius:  '2px',
                 marginLeft:    'auto',
         });

      const dismissBtn = banner.querySelector('#m4tr1x-btn-dismiss');
         Object.assign(dismissBtn.style, {
                 background:  'transparent',
                 border:      'none',
                 cursor:      'pointer',
                 fontSize:    '16px',
                 color:       '#000',
                 padding:     '0 4px',
         });

      // Inject slide-down keyframes once
      if (!document.getElementById('m4tr1x-update-styles')) {
              const style = document.createElement('style');
              style.id = 'm4tr1x-update-styles';
              style.textContent = `
                      @keyframes slideDown {
                                from { transform: translateY(-100%); opacity: 0; }
                                          to   { transform: translateY(0);    opacity: 1; }
                                                  }
                                                        `;
              document.head.appendChild(style);
      }

      return banner;
   }

   // ── Show Banner ─────────────────────────────────────────────────────────────
   function showUpdateBanner(version, notes) {
         // Don't show twice
      if (document.getElementById('m4tr1x-update-banner')) return;

      const banner = createBanner(version, notes);
         document.body.prepend(banner);

      // Dismiss button
      banner.querySelector('#m4tr1x-btn-dismiss').addEventListener('click', () => {
              banner.remove();
      });

      // Install button
      banner.querySelector('#m4tr1x-btn-install').addEventListener('click', async () => {
              const installBtn = banner.querySelector('#m4tr1x-btn-install');
              installBtn.textContent = 'DOWNLOAD IN CORSO…';
              installBtn.disabled = true;

                                                                         try {
                                                                                   const result = await invoke('check_for_updates');
                                                                                   installBtn.textContent = 'RIAVVIA PER COMPLETARE';
                                                                                   installBtn.style.background = '#003300';

                // After 3 s, show restart prompt
                setTimeout(() => {
                            if (confirm('Aggiornamento installato.\nRiavviare M4TR1X adesso?')) {
                                          invoke('plugin:process|restart').catch(() =>
                                                          alert('Riavvia manualmente l\'app per applicare l\'aggiornamento.')
                                                                                             );
                            }
                }, 3000);
                                                                         } catch (err) {
                                                                                   installBtn.textContent = 'ERRORE — RIPROVA';
                                                                                   installBtn.disabled = false;
                                                                                   console.error('[M4TR1X Updater]', err);
                                                                         }
      });
   }

   // ── Listen for Rust event ───────────────────────────────────────────────────
   listen('update-available', (event) => {
         const { version, body } = event.payload || {};
         if (version) {
                 showUpdateBanner(version, body);
         }
   }).catch((err) => {
         console.warn('[M4TR1X Updater] Could not register listener:', err);
   });

})();
