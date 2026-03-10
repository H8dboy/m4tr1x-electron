/**
 * M4TR1X - Monero Wallet Integration
 *
 * Gestisce il wallet XMR integrato nell'app:
 *  - Creazione / ripristino wallet da seed mnemonico
 *  - Generazione subaddress univoci per ogni pagamento (privacy by design)
 *  - Verifica pagamenti in entrata
 *  - Invio XMR
 *
 * Libreria: monero-javascript (ufficiale monero-project, usa WebAssembly)
 * Nodo:     remote node pubblico (le chiavi restano sempre sul dispositivo)
 *
 * PRIVACY NOTE:
 *   I subaddress di Monero sono stealth addresses — ogni transazione è
 *   separata e irrintracciabile. Nessuno può collegare due pagamenti
 *   allo stesso utente guardando la blockchain.
 */

const path = require('path')
const fs   = require('fs')

// ─── Config ───────────────────────────────────────────────────────────────────

// Nodi pubblici Monero — l'app si connette a uno di questi (nessun dato inviato)
// L'utente può anche cambiarlo nelle impostazioni per usare il proprio nodo.
const PUBLIC_NODES = [
  'https://xmr-node.cakewallet.com:18081',
  'https://node.moneroworld.com:18089',
  'https://nodes.hashvault.pro:18081',
]

const NETWORK_TYPE = 'mainnet' // cambia in 'stagenet' per test

// ─── Stato interno ────────────────────────────────────────────────────────────
let wallet     = null   // istanza wallet attiva
let monerojs   = null   // libreria (caricata lazy per non rallentare l'avvio)
let walletPath = null   // percorso file wallet sul disco

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getWalletDir() {
  try {
    const { app } = require('electron')
    return path.join(app.getPath('userData'), 'wallet')
  } catch {
    return path.join(process.cwd(), 'wallet')
  }
}

async function getLib() {
  if (!monerojs) {
    monerojs = await import('monero-javascript')
  }
  return monerojs
}

function pickNode() {
  // Sceglie un nodo casuale dalla lista (load balancing minimale)
  return PUBLIC_NODES[Math.floor(Math.random() * PUBLIC_NODES.length)]
}

// ─── API pubblica ─────────────────────────────────────────────────────────────

/**
 * Crea un nuovo wallet XMR.
 * Restituisce il seed mnemonico da mostrare all'utente UNA SOLA VOLTA.
 * Il wallet viene salvato cifrato con la password fornita.
 *
 * @param {string} password - Password di cifratura del file wallet
 * @returns {{ address: string, seed: string }}
 */
async function createWallet(password) {
  const lib  = await getLib()
  const dir  = getWalletDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  walletPath = path.join(dir, 'm4tr1x_wallet')

  wallet = await lib.createWalletFull({
    path:        walletPath,
    password,
    networkType: NETWORK_TYPE,
    server:      { uri: pickNode(), rejectUnauthorized: false },
  })

  const address = await wallet.getPrimaryAddress()
  const seed    = await wallet.getSeed()

  console.log(`[XMR] Nuovo wallet creato: ${address.substring(0, 16)}...`)
  return { address, seed }
}

/**
 * Ripristina un wallet esistente da seed mnemonico.
 *
 * @param {string} seed      - Seed mnemonico (25 parole)
 * @param {string} password  - Password per cifrare il file wallet
 * @param {number} restoreHeight - Blocco da cui partire (0 = inizio, usa l'altezza attuale se recente)
 * @returns {{ address: string }}
 */
async function restoreWallet(seed, password, restoreHeight = 0) {
  const lib = await getLib()
  const dir = getWalletDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  walletPath = path.join(dir, 'm4tr1x_wallet')

  wallet = await lib.createWalletFull({
    path:          walletPath,
    password,
    networkType:   NETWORK_TYPE,
    seed,
    restoreHeight,
    server:        { uri: pickNode(), rejectUnauthorized: false },
  })

  const address = await wallet.getPrimaryAddress()
  console.log(`[XMR] Wallet ripristinato: ${address.substring(0, 16)}...`)
  return { address }
}

/**
 * Apre un wallet esistente dal disco.
 *
 * @param {string} password - Password del wallet
 * @returns {boolean} true se aperto con successo
 */
async function openWallet(password) {
  const lib  = await getLib()
  const dir  = getWalletDir()
  walletPath = path.join(dir, 'm4tr1x_wallet')

  if (!fs.existsSync(walletPath + '.keys')) {
    return false // wallet non esiste ancora
  }

  try {
    wallet = await lib.openWalletFull({
      path:        walletPath,
      password,
      networkType: NETWORK_TYPE,
      server:      { uri: pickNode(), rejectUnauthorized: false },
    })
    console.log('[XMR] Wallet aperto.')
    return true
  } catch (err) {
    console.error('[XMR] Errore apertura wallet:', err.message)
    return false
  }
}

/**
 * Controlla se esiste già un wallet salvato sul disco.
 */
function walletExists() {
  const dir = getWalletDir()
  return fs.existsSync(path.join(dir, 'm4tr1x_wallet.keys'))
}

/**
 * Sincronizza il wallet con la blockchain (aggiorna saldo e transazioni).
 * Emette progressi tramite callback opzionale.
 *
 * @param {Function} onProgress - callback({ percentDone, message })
 */
async function syncWallet(onProgress) {
  if (!wallet) throw new Error('Wallet not open')

  if (onProgress) {
    await wallet.addListener({
      onSyncProgress(height, startHeight, endHeight, percentDone, message) {
        onProgress({ percentDone: Math.round(percentDone * 100), message })
      },
    })
  }

  await wallet.sync()
  console.log('[XMR] Sync completato.')
}

/**
 * Restituisce il saldo del wallet.
 * @returns {{ total: string, unlocked: string }} — in XMR (non in picoXMR)
 */
async function getBalance() {
  if (!wallet) throw new Error('Wallet not open')

  const lib       = await getLib()
  const total     = await wallet.getBalance()
  const unlocked  = await wallet.getUnlockedBalance()

  // Monero usa picoXMR internamente (1 XMR = 1e12 picoXMR)
  const toXMR = (pico) => (Number(pico) / 1e12).toFixed(12)

  return {
    total:    toXMR(total),
    unlocked: toXMR(unlocked),
    raw: { total: total.toString(), unlocked: unlocked.toString() },
  }
}

/**
 * Restituisce l'indirizzo primario del wallet.
 */
async function getPrimaryAddress() {
  if (!wallet) throw new Error('Wallet not open')
  return wallet.getPrimaryAddress()
}

/**
 * Genera un subaddress univoco per un pagamento specifico.
 * Ogni prodotto nel shop riceve un subaddress diverso —
 * impossibile collegare due acquisti allo stesso venditore guardando la blockchain.
 *
 * @param {number} accountIndex   - Account (default 0)
 * @param {string} label          - Etichetta opzionale (es. "Shop: prodotto XY")
 * @returns {{ address: string, index: number }}
 */
async function createSubaddress(accountIndex = 0, label = '') {
  if (!wallet) throw new Error('Wallet not open')

  const subaddress = await wallet.createSubaddress(accountIndex, label)
  return {
    address: subaddress.getAddress(),
    index:   subaddress.getIndex(),
  }
}

/**
 * Controlla se un pagamento è stato ricevuto su un subaddress specifico.
 * Usato dallo shop per confermare gli acquisti.
 *
 * @param {string} subaddress        - Indirizzo XMR da monitorare
 * @param {string} expectedAmountXMR - Importo atteso in XMR (es. "0.05")
 * @param {number} minConfirmations  - Conferme minime (default 10, ~20 min)
 * @returns {{ paid: boolean, confirmations: number, txid: string|null }}
 */
async function checkPaymentReceived(subaddress, expectedAmountXMR, minConfirmations = 10) {
  if (!wallet) throw new Error('Wallet not open')

  const expectedPico = BigInt(Math.round(parseFloat(expectedAmountXMR) * 1e12))

  await wallet.sync()

  const transfers = await wallet.getIncomingTransfers({
    address: subaddress,
  })

  for (const transfer of transfers) {
    const received     = BigInt(transfer.getAmount().toString())
    const confirmations = transfer.getTx()?.getNumConfirmations() ?? 0

    if (received >= expectedPico && confirmations >= minConfirmations) {
      return {
        paid:          true,
        confirmations,
        txid:          transfer.getTx()?.getHash() ?? null,
        amountReceived: (Number(received) / 1e12).toFixed(12),
      }
    }
  }

  return { paid: false, confirmations: 0, txid: null }
}

/**
 * Invia XMR a un indirizzo.
 *
 * @param {string} toAddress  - Indirizzo XMR destinatario
 * @param {string} amountXMR  - Importo in XMR (es. "0.1")
 * @param {number} priority   - 1=normale, 2=elevata, 3=massima
 * @returns {{ txid: string, fee: string }}
 */
async function sendPayment(toAddress, amountXMR, priority = 1) {
  if (!wallet) throw new Error('Wallet not open')

  const amountPico = BigInt(Math.round(parseFloat(amountXMR) * 1e12))

  const tx = await wallet.createTx({
    accountIndex: 0,
    address:      toAddress,
    amount:       amountPico,
    priority,
    relay:        true,
  })

  const txid = tx.getHash()
  const fee  = (Number(tx.getFee().toString()) / 1e12).toFixed(12)

  console.log(`[XMR] Transazione inviata: ${txid}`)
  return { txid, fee }
}

/**
 * Chiude il wallet in modo sicuro (salva e disconnette).
 */
async function closeWallet() {
  if (wallet) {
    await wallet.close(true) // true = salva prima di chiudere
    wallet = null
    console.log('[XMR] Wallet chiuso.')
  }
}

module.exports = {
  createWallet,
  restoreWallet,
  openWallet,
  walletExists,
  syncWallet,
  getBalance,
  getPrimaryAddress,
  createSubaddress,
  checkPaymentReceived,
  sendPayment,
  closeWallet,
}
