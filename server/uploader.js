/**
 * M4TR1X - Video Encryption
 * AES-256-GCM encryption using Node.js native crypto.
 *
 * Encrypted file format: [IV 16 bytes] + [AuthTag 16 bytes] + [encrypted data]
 */

const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH  = 16
const TAG_LENGTH = 16

/**
 * Generates a new random encryption key (32 bytes = AES-256).
 */
function generateKey() {
  return crypto.randomBytes(32)
}

/**
 * Loads the key from file. Generates a new one if it doesn't exist.
 * @param {string} keyPath - Path to the key file
 */
function loadOrCreateKey(keyPath = 'nexus.key') {
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath)
  }
  const key = generateKey()
  fs.writeFileSync(keyPath, key)
  console.log(`[UPLOADER] New key generated: ${keyPath}`)
  return key
}

/**
 * Encrypts a video. Returns the path to the encrypted .nexus file.
 * @param {string} inputPath  - Path to the original video
 * @param {Buffer} keyBuffer  - AES-256 key (32 bytes)
 */
function encryptVideo(inputPath, keyBuffer) {
  const iv     = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv)

  const plaintext  = fs.readFileSync(inputPath)
  const encrypted  = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag    = cipher.getAuthTag()

  // Format: IV + AuthTag + encrypted data
  const output = Buffer.concat([iv, authTag, encrypted])

  const outputPath = path.join(
    path.dirname(inputPath),
    `GHOST_${path.basename(inputPath)}.nexus`
  )
  fs.writeFileSync(outputPath, output)

  console.log(`[UPLOADER] Video encrypted: ${outputPath}`)
  return outputPath
}

/**
 * Decrypts a .nexus file. Returns a Buffer with the original data.
 * @param {string} encryptedPath - Path to the .nexus file
 * @param {Buffer} keyBuffer     - AES-256 key (32 bytes)
 */
function decryptVideo(encryptedPath, keyBuffer) {
  const data    = fs.readFileSync(encryptedPath)
  const iv      = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const payload = data.subarray(IV_LENGTH + TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(payload), decipher.final()])
}

module.exports = { generateKey, loadOrCreateKey, encryptVideo, decryptVideo }
