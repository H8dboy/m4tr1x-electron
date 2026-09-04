# Tor bundled binaries

Questa cartella viene **popolata al build time** da `scripts/fetch-tor.sh`
(hook `prepack`): scarica il Tor Expert Bundle ufficiale del Tor Project per
Linux/macOS/Windows in `resources/tor/<piattaforma-arch>/`.

electron-builder li impacchetta (`extraResources` → `resources/tor/`), così
l'app desktop avvia il proprio Tor e pubblica l'onion **senza** che l'utente
installi nulla. `server/tor_node.js` (`_findTor`) preferisce questo binario,
poi eventuale Tor di sistema.

I binari non sono in git (`.gitignore`): esegui `npm run fetch-tor` prima di
`npm run build`, oppure lascia fare all'hook `prepack`.
