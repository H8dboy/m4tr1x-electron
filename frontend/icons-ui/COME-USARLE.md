# Icone M4TR1X — come usarle

71 file .svg singoli + sprite.svg (rigenerato). Colore ereditato via `currentColor`.

## Opzione A — inline (consigliata, è come fa il mockup)
Apri il .svg, copia il tag <svg> e incollalo nell'HTML. Il colore lo dà il CSS del genitore (es. .nav-item { color: var(--green) }).

## Opzione B — sprite
Incolla il contenuto di sprite.svg in fondo al <body> una sola volta, poi:
`<svg width="21" height="21"><use href="#ic-signal"/></svg>`

## Opzione C — file esterno
`<img src="icons/signal.svg">` — NB: con <img> currentColor non funziona (resta il colore di default). Usala solo per icone monocrome fisse.

## Dimensioni standard
nav 21px · azioni feed 24–26px · header 19–20px · badge/inline 13–15px

## Mappa emoji → icona
📡 signal · 🎬 film · 🎵 music · 🏛️ forum · 🛍️ shop · 💬 dm · ❤️ like · ⚡ tip · 🔁 repost · 🔖 save · 🔍 search · 🔔 bell · ✅/🛡️ verified · 🔒 lock · ➡️ send · 👤 profile · ➕ plus · ⚙️ settings · 🌐 relay · 🔑 key · 📋 copy · 👁 eye/eye-off · ▶️ play · ⏸ pause · ✔✔ check-double · ⬆️ upload · ⬇️ download · ✏️ edit · 🗑 trash · ⚠️ warning · 👛 wallet · 📷 camera · 🎤 mic · 🔊 volume · 🔇 mute · 🚪 logout · 🔗 link · #️⃣ hash · 🏠 home · ❌ close · ⋯ menu · ◀ back

## Aggiunte v3
UI: live · stop · refresh · x-circle · check-circle · photo · video · tor · node · star(+filled) · reply · mention
Stati attivi (filled): like-filled · save-filled · verified-filled — il "letto" delle DM è check-double
Badge professionali (11, glifi distinti da TIP e FORUM): pro-it (chip) · pro-gov (sigillo colonne in cerchio) · pro-health · pro-legal (bilancia) · pro-press · pro-eng · pro-edu · pro-finance · pro-science · pro-security · pro-arts
⚠ I nomi delle 11 categorie sono una proposta: mandami la lista reale dei badge professionale e li rinomino/completo.
