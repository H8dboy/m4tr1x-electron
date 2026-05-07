#!/usr/bin/env node
/**
 * M4TR1X - Download Tor Binaries Script
 * 
 * Scarica i binari Tor ufficiali per la piattaforma corrente
 * e li salva in ./tor-bin/ per il bundle Electron.
 * 
 * Esecuzione:
 *   npm run download-tor-binaries
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const { extract } = require('tar')
const { createWriteStream } = require('fs')

const TOR_VERSION = '14.0.3' // Aggiornare periodicamente

const DOWNLOADS = {
  win32: [
    {
      arch: 'x64',
      url: `https://www.torproject.org/dist/torbrowser/${TOR_VERSION}/tor-expert-bundle-windows-x86_64.zip`,
      file: `tor-windows-x64-${TOR_VERSION}.zip`
    },
    {
      arch: 'ia32',
      url: `https://www.torproject.org/dist/torbrowser/${TOR_VERSION}/tor-expert-bundle-windows-i686.zip`,
      file: `tor-windows-x86-${TOR_VERSION}.zip`
    }
  ],
  darwin: [
    {
      arch: 'x64',
      url: `https://www.torproject.org/dist/torbrowser/${TOR_VERSION}/tor-expert-bundle-macos-x86_64.tar.gz`,
      file: `tor-macos-x64-${TOR_VERSION}.tar.gz`
    },
    {
      arch: 'arm64',
      url: `https://www.torproject.org/dist/torbrowser/${TOR_VERSION}/tor-expert-bundle-macos-aarch64.tar.gz`,
      file: `tor-macos-arm64-${TOR_VERSION}.tar.gz`
    }
  ],
  linux: [
    {
      arch: 'x64',
      url: `https://www.torproject.org/dist/torbrowser/${TOR_VERSION}/tor-expert-bundle-linux-x86_64.tar.gz`,
      file: `tor-linux-x64-${TOR_VERSION}.tar.gz`
    },
    {
      arch: 'arm64',
      url: `https://www.torproject.org/dist/torbrowser/${TOR_VERSION}/tor-expert-bundle-linux-aarch64.tar.gz`,
      file: `tor-linux-arm64-${TOR_VERSION}.tar.gz`
    }
  ]
}

function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    console.log(`[TOR] Scaricando: ${path.basename(filepath)}...`)
    const file = createWriteStream(filepath)
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`))
        return
      }
      
      const totalSize = parseInt(response.headers['content-length'], 10)
      let downloadedSize = 0
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length
        const percent = ((downloadedSize / totalSize) * 100).toFixed(1)
        process.stdout.write(`\r[TOR] Download: ${percent}%`)
      })
      
      response.pipe(file)
      file.on('finish', () => {
        file.close()
        console.log('\n[TOR] ✅ Scaricamento completato')
        resolve()
      })
    }).on('error', (err) => {
      fs.unlink(filepath, () => {})
      reject(err)
    })
  })
}

async function extractTar(filepath, outdir) {
  console.log(`[TOR] Estrazione: ${path.basename(filepath)}...`)
  await extract({
    file: filepath,
    cwd: outdir,
    strip: 0
  })
  console.log('[TOR] ✅ Estrazione completata')
  fs.unlinkSync(filepath) // Rimuovi archivio
}

async function main() {
  console.log(`[TOR] M4TR1X Tor Binaries Downloader v${TOR_VERSION}`)
  console.log(`[TOR] Platform: ${process.platform} (${process.arch})`)
  
  const torBinDir = path.join(__dirname, '..', 'tor-bin')
  if (!fs.existsSync(torBinDir)) {
    fs.mkdirSync(torBinDir, { recursive: true })
  }
  
  const platformDownloads = DOWNLOADS[process.platform]
  if (!platformDownloads) {
    console.error(`[TOR] ❌ Piattaforma non supportata: ${process.platform}`)
    process.exit(1)
  }
  
  for (const download of platformDownloads) {
    try {
      const tempFile = path.join(torBinDir, download.file)
      const outDir = path.join(torBinDir, process.platform, download.arch)
      
      if (fs.existsSync(outDir)) {
        console.log(`[TOR] ⏭️  ${download.arch} già presente, skip`)
        continue
      }
      
      await downloadFile(download.url, tempFile)
      fs.mkdirSync(outDir, { recursive: true })
      
      if (download.file.endsWith('.tar.gz')) {
        await extractTar(tempFile, outDir)
      } else if (download.file.endsWith('.zip')) {
        // Per Windows, usa unzip
        const { execSync } = require('child_process')
        execSync(`unzip -q "${tempFile}" -d "${outDir}"`, { stdio: 'inherit' })
        fs.unlinkSync(tempFile)
      }
      
    } catch (err) {
      console.error(`[TOR] ❌ Errore download ${download.arch}:`, err.message)
      process.exit(1)
    }
  }
  
  console.log('[TOR] ✅ Tutti i binari Tor pronti!')
  console.log('[TOR] Struttura:')
  console.log(`     ${torBinDir}/`)
  console.log(`     ├── win/`)
  console.log(`     │   ├── tor.exe (x64)`)
  console.log(`     │   └── tor-x86.exe (x86)`)
  console.log(`     ├── macos/`)
  console.log(`     │   ├── tor-x64`)
  console.log(`     │   └── tor-arm64`)
  console.log(`     └── linux/`)
  console.log(`         ├── tor-x64`)
  console.log(`         └── tor-arm64`)
}

main().catch(err => {
  console.error('[TOR] ❌ Errore:', err)
  process.exit(1)
})
