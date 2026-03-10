/**
 * M4TR1X - Decentralized Shop (XMR)
 *
 * Marketplace decentralizzato dove:
 *  - I venditori pubblicano i loro prodotti
 *  - Ogni acquisto genera un subaddress XMR univoco (privacy by design)
 *  - Il pagamento viene verificato direttamente sulla blockchain Monero
 *  - Nessun intermediario, nessuna fee di piattaforma
 *
 * Tutto gira in locale nel dispositivo dell'utente.
 */

const Database = require('better-sqlite3')
const path     = require('path')
const { v4: uuidv4 } = require('uuid')
const {
  createSubaddress,
  checkPaymentReceived,
} = require('./monero')

// ─── Database ─────────────────────────────────────────────────────────────────

let db

function getShopDbPath() {
  try {
    const { app } = require('electron')
    return path.join(app.getPath('userData'), 'shop.db')
  } catch {
    return path.join(process.cwd(), 'shop.db')
  }
}

function initShopDb() {
  db = new Database(getShopDbPath())

  db.exec(`
    -- Prodotti in vendita
    CREATE TABLE IF NOT EXISTS listings (
      id           TEXT PRIMARY KEY,
      seller_pubkey TEXT NOT NULL,
      title        TEXT NOT NULL,
      description  TEXT,
      price_xmr    TEXT NOT NULL,       -- prezzo in XMR (stringa per precisione)
      category     TEXT DEFAULT 'other',
      image_emoji  TEXT DEFAULT '📦',
      created_at   TEXT NOT NULL,
      active       INTEGER DEFAULT 1
    );

    -- Ordini / acquisti
    CREATE TABLE IF NOT EXISTS orders (
      id              TEXT PRIMARY KEY,
      listing_id      TEXT NOT NULL,
      buyer_pubkey    TEXT,
      seller_pubkey   TEXT NOT NULL,
      amount_xmr      TEXT NOT NULL,
      payment_address TEXT NOT NULL,    -- subaddress XMR univoco per questo ordine
      payment_index   INTEGER NOT NULL,
      status          TEXT DEFAULT 'pending',   -- pending | confirmed | cancelled
      tx_hash         TEXT,
      confirmations   INTEGER DEFAULT 0,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      FOREIGN KEY(listing_id) REFERENCES listings(id)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_address  ON orders(payment_address);
    CREATE INDEX IF NOT EXISTS idx_orders_listing  ON orders(listing_id);
    CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_pubkey);
  `)

  console.log('[SHOP] Database inizializzato.')
}

// ─── Listings ─────────────────────────────────────────────────────────────────

/**
 * Crea un nuovo prodotto nel shop.
 *
 * @param {Object} params
 * @param {string} params.sellerPubkey  - Chiave pubblica Nostr del venditore
 * @param {string} params.title         - Nome prodotto
 * @param {string} params.description   - Descrizione
 * @param {string} params.priceXMR      - Prezzo in XMR (es. "0.05")
 * @param {string} params.category      - Categoria (physical, digital, service, art, other)
 * @param {string} params.imageEmoji    - Emoji rappresentativa
 */
function createListing({ sellerPubkey, title, description, priceXMR, category = 'other', imageEmoji = '📦' }) {
  const id = uuidv4().substring(0, 12)

  db.prepare(`
    INSERT INTO listings (id, seller_pubkey, title, description, price_xmr, category, image_emoji, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sellerPubkey, title, description || '', priceXMR, category, imageEmoji, new Date().toISOString())

  console.log(`[SHOP] Nuovo prodotto: "${title}" a ${priceXMR} XMR`)
  return id
}

/**
 * Restituisce tutti i prodotti attivi.
 */
function getListings({ category, limit = 50 } = {}) {
  let query = 'SELECT * FROM listings WHERE active = 1'
  const params = []

  if (category) {
    query += ' AND category = ?'
    params.push(category)
  }

  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  return db.prepare(query).all(...params)
}

/**
 * Restituisce un singolo prodotto per ID.
 */
function getListing(id) {
  return db.prepare('SELECT * FROM listings WHERE id = ?').get(id) || null
}

/**
 * Disattiva un prodotto (soft delete).
 */
function deactivateListing(id, sellerPubkey) {
  db.prepare('UPDATE listings SET active = 0 WHERE id = ? AND seller_pubkey = ?').run(id, sellerPubkey)
}

// ─── Orders ───────────────────────────────────────────────────────────────────

/**
 * Avvia un acquisto:
 *  1. Verifica che il prodotto esista
 *  2. Genera un subaddress XMR univoco per questo ordine
 *  3. Salva l'ordine in stato "pending"
 *  4. Restituisce l'indirizzo di pagamento e l'importo
 *
 * @param {string} listingId    - ID del prodotto
 * @param {string} buyerPubkey  - Chiave pubblica Nostr dell'acquirente (opzionale)
 * @returns {{ orderId, paymentAddress, amountXMR, expiresAt }}
 */
async function initiateOrder(listingId, buyerPubkey = null) {
  const listing = getListing(listingId)
  if (!listing) throw new Error('Product not found')
  if (!listing.active) throw new Error('Product no longer available')

  // Guard: XMR wallet must be open to generate payment subaddress
  const { walletExists, openWallet: _openWallet } = require('./monero')
  if (!walletExists()) {
    throw new Error(
      'XMR wallet not configured. Create or open a wallet before making purchases. ' +
      'Go to Settings → XMR Wallet.'
    )
  }

  // Generate unique subaddress — each order gets its own XMR address
  let address, index
  try {
    ;({ address, index } = await createSubaddress(0, `M4TR1X Shop: ${listing.title}`))
  } catch (err) {
    if (err.message.includes('Wallet non aperto') || err.message.includes('wallet')) {
      throw new Error(
        'XMR wallet locked. Unlock your wallet with your password before proceeding.'
      )
    }
    throw err
  }

  const orderId  = uuidv4().substring(0, 12)
  const now      = new Date().toISOString()

  db.prepare(`
    INSERT INTO orders
      (id, listing_id, buyer_pubkey, seller_pubkey, amount_xmr, payment_address, payment_index, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(orderId, listingId, buyerPubkey, listing.seller_pubkey, listing.price_xmr, address, index, now, now)

  console.log(`[SHOP] Nuovo ordine ${orderId} — ${listing.price_xmr} XMR → ${address.substring(0, 16)}...`)

  // Scadenza pagamento: 30 minuti
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

  return {
    orderId,
    paymentAddress: address,
    amountXMR:      listing.price_xmr,
    listingTitle:   listing.title,
    expiresAt,
  }
}

/**
 * Verifica se un ordine è stato pagato controllando la blockchain Monero.
 * Aggiorna lo stato dell'ordine di conseguenza.
 *
 * @param {string} orderId
 * @returns {{ status: string, confirmations: number, txid: string|null }}
 */
async function verifyOrderPayment(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
  if (!order) throw new Error('Order not found')

  // Se già confermato, non serve richeccare
  if (order.status === 'confirmed') {
    return { status: 'confirmed', confirmations: order.confirmations, txid: order.tx_hash }
  }

  const result = await checkPaymentReceived(order.payment_address, order.amount_xmr)

  if (result.paid) {
    db.prepare(`
      UPDATE orders SET status = 'confirmed', tx_hash = ?, confirmations = ?, updated_at = ?
      WHERE id = ?
    `).run(result.txid, result.confirmations, new Date().toISOString(), orderId)

    console.log(`[SHOP] Ordine ${orderId} CONFERMATO — tx: ${result.txid}`)
    return { status: 'confirmed', confirmations: result.confirmations, txid: result.txid }
  }

  return { status: 'pending', confirmations: 0, txid: null }
}

/**
 * Restituisce un ordine per ID.
 */
function getOrder(orderId) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) || null
}

/**
 * Lista gli ordini del venditore.
 */
function getSellerOrders(sellerPubkey, limit = 50) {
  return db.prepare(
    'SELECT * FROM orders WHERE seller_pubkey = ? ORDER BY created_at DESC LIMIT ?'
  ).all(sellerPubkey, limit)
}

/**
 * Lista gli ordini dell'acquirente.
 */
function getBuyerOrders(buyerPubkey, limit = 50) {
  return db.prepare(
    'SELECT * FROM orders WHERE buyer_pubkey = ? ORDER BY created_at DESC LIMIT ?'
  ).all(buyerPubkey, limit)
}

module.exports = {
  initShopDb,
  // Listings
  createListing,
  getListings,
  getListing,
  deactivateListing,
  // Orders
  initiateOrder,
  verifyOrderPayment,
  getOrder,
  getSellerOrders,
  getBuyerOrders,
}
