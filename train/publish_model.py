#!/usr/bin/env python3
"""
M4TR1X - Pubblicazione Modello su Nostr

Dopo il training, questo script:
  1. Carica il file ONNX su IPFS (o usa un URL diretto fornito dall'utente)
  2. Pubblica un evento Nostr che annuncia la nuova versione del modello
  3. L'app M4TR1X scarica automaticamente il modello al prossimo avvio

Uso con IPFS:
    python publish_model.py --onnx ../models/m4tr1x_detector.onnx \
        --version 2025.06.01 --accuracy 0.923 --samples 5000

Uso con URL diretto (es. GitHub Releases, Blossom):
    python publish_model.py --onnx ../models/m4tr1x_detector.onnx \
        --url https://github.com/H8dboy/m4tr1x/releases/download/v2.1/m4tr1x_detector.onnx \
        --version 2.1.0 --accuracy 0.923 --samples 5000
"""

import json
import os
import sys
import argparse
import hashlib
import asyncio
from pathlib import Path
from datetime import datetime

# ─── Hash ─────────────────────────────────────────────────────────────────────

def compute_sha256(file_path):
    with open(file_path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()

# ─── Upload IPFS ──────────────────────────────────────────────────────────────

def upload_to_ipfs(file_path):
    """Carica il file su IPFS e restituisce il CID (URL ipfs://...)."""
    try:
        import ipfshttpclient
        client = ipfshttpclient.connect()
        result = client.add(file_path, pin=True)
        cid    = result['Hash']
        url    = f'https://ipfs.io/ipfs/{cid}'
        print(f'[IPFS] Caricato con successo: {url}')
        return url, cid
    except ImportError:
        print('[IPFS] ⚠ ipfs-http-client non installato. Usa --url per specificare un URL diretto.')
        return None, None
    except Exception as e:
        print(f'[IPFS] ⚠ Errore upload: {e}')
        print('[IPFS]   Assicurati che IPFS Desktop o il daemon ipfs siano in esecuzione.')
        return None, None

# ─── Pubblicazione Nostr ───────────────────────────────────────────────────────

async def publish_to_nostr(url, version, sha256, accuracy, samples, privkey_hex):
    """Pubblica l'annuncio del modello su Nostr."""
    try:
        import websockets
    except ImportError:
        print('[NOSTR] ⚠ websockets non installato. Installa con: pip install websockets')
        return False

    # Costruisci e firma l'evento manualmente (senza dipendere da nostr-tools)
    import time
    import json
    import hashlib
    import hmac

    # Derivazione pubkey da privkey usando secp256k1
    try:
        from cryptography.hazmat.primitives.asymmetric.ec import (
            SECP256K1, EllipticCurvePrivateKey, generate_private_key
        )
        from cryptography.hazmat.primitives import serialization
        import secrets

        # Usa secp256k1 tramite coincurve se disponibile
        try:
            import coincurve
            privkey_bytes = bytes.fromhex(privkey_hex)
            priv = coincurve.PrivateKey(privkey_bytes)
            pubkey_hex = priv.public_key.format(compressed=True)[1:].hex()  # x-only
        except ImportError:
            print('[NOSTR] ⚠ coincurve non installato. Installa con: pip install coincurve')
            print('[NOSTR]   In alternativa, usa l\'API locale di M4TR1X per pubblicare.')
            return False
    except Exception as e:
        print(f'[NOSTR] ⚠ Impossibile derivare pubkey: {e}')
        return False

    created_at = int(time.time())
    tags = [
        ['d',          f'm4tr1x-model-v{version}'],
        ['url',        url],
        ['version',    version],
        ['hash_model', sha256],
        ['accuracy',   str(round(accuracy, 4))],
        ['samples',    str(samples)],
        ['t',          'm4tr1x'],
        ['t',          'model-update'],
    ]

    event_data = [0, pubkey_hex, created_at, 30078, tags, '']
    event_json = json.dumps(event_data, separators=(',', ':'), ensure_ascii=False)
    event_id   = hashlib.sha256(event_json.encode()).hexdigest()

    # Firma Schnorr (richiede coincurve con supporto Schnorr)
    try:
        import coincurve
        from coincurve._libsecp256k1 import ffi, lib
        privkey_bytes = bytes.fromhex(privkey_hex)
        msg = bytes.fromhex(event_id)
        aux_rand = secrets.token_bytes(32)
        sig = coincurve.PrivateKey(privkey_bytes).sign_schnorr(msg, aux_rand)
        sig_hex = sig.hex()
    except Exception as e:
        print(f'[NOSTR] ⚠ Impossibile firmare: {e}')
        return False

    signed_event = {
        'id':         event_id,
        'pubkey':     pubkey_hex,
        'created_at': created_at,
        'kind':       30078,
        'tags':       tags,
        'content':    '',
        'sig':        sig_hex,
    }

    relays = [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band',
        'wss://nostr.wine',
    ]

    published = 0
    for relay_url in relays:
        try:
            async with websockets.connect(relay_url, open_timeout=5) as ws:
                await ws.send(json.dumps(['EVENT', signed_event]))
                response = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(response)
                if data[0] == 'OK' and data[2]:
                    print(f'[NOSTR] ✅ Pubblicato su {relay_url}')
                    published += 1
                else:
                    print(f'[NOSTR] ⚠ {relay_url}: {data}')
        except Exception as e:
            print(f'[NOSTR] ⚠ {relay_url}: {e}')

    return published > 0

# ─── Pubblicazione via API locale ──────────────────────────────────────────────

def publish_via_api(url, version, sha256, accuracy, samples):
    """Pubblica tramite l'API locale di M4TR1X (più semplice, non serve privkey)."""
    import requests
    api_base = os.environ.get('M4TR1X_API', 'http://localhost:8080')
    api_key  = os.environ.get('M4TR1X_API_KEY', '')
    headers  = {'Content-Type': 'application/json'}
    if api_key:
        headers['X-API-Key'] = api_key

    try:
        r = requests.post(f'{api_base}/api/v1/train/model', headers=headers, json={
            'version':    version,
            'url':        url,
            'hash_model': sha256,
            'accuracy':   accuracy,
            'samples':    samples,
        }, timeout=10)
        r.raise_for_status()
        print(f'[API] Modello registrato localmente: v{version}')
        return True
    except Exception as e:
        print(f'[API] ⚠ Registrazione locale fallita: {e}')
        return False

# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='M4TR1X — Pubblica modello su Nostr')
    parser.add_argument('--onnx',     required=True,  help='Percorso file .onnx')
    parser.add_argument('--version',  required=True,  help='Versione (es. 2025.06.01 o 2.1.0)')
    parser.add_argument('--accuracy', type=float, required=True, help='Accuratezza del modello (0.0-1.0)')
    parser.add_argument('--samples',  type=int,   required=True, help='Numero video nel training set')
    parser.add_argument('--url',      default=None, help='URL diretto del file .onnx (se non usi IPFS)')
    parser.add_argument('--privkey',  default=None, help='Chiave privata Nostr hex (per firmare l\'evento)')
    parser.add_argument('--ipfs',     action='store_true', help='Carica su IPFS automaticamente')
    args = parser.parse_args()

    onnx_path = Path(args.onnx)
    if not onnx_path.exists():
        print(f'[ERROR] File non trovato: {onnx_path}')
        sys.exit(1)

    print('=' * 60)
    print('M4TR1X — Pubblicazione Modello')
    print('=' * 60)
    print(f'  File:      {onnx_path} ({onnx_path.stat().st_size / 1024 / 1024:.1f} MB)')
    print(f'  Versione:  {args.version}')
    print(f'  Accuratezza: {args.accuracy * 100:.2f}%')
    print(f'  Campioni:  {args.samples}')

    # Verifica sha256
    sha256 = compute_sha256(onnx_path)
    print(f'  SHA-256:   {sha256}')

    # Ottieni URL
    url = args.url
    if not url and args.ipfs:
        print('\n[IPFS] Caricamento su IPFS...')
        url, _ = upload_to_ipfs(str(onnx_path))

    if not url:
        print('\n[ERROR] Specifica --url oppure usa --ipfs per caricare automaticamente.')
        print('  Opzioni per ospitare il modello:')
        print('  - GitHub Releases (gratuito, affidabile)')
        print('  - IPFS (decentralizzato, usa --ipfs)')
        print('  - Blossom (decentralizzato Nostr-native)')
        print('  - Qualsiasi hosting di file')
        sys.exit(1)

    print(f'\n  URL: {url}')

    # Registra localmente via API
    publish_via_api(url, args.version, sha256, args.accuracy, args.samples)

    # Pubblica su Nostr
    if args.privkey:
        print('\n[NOSTR] Pubblicazione evento su relay Nostr...')
        success = asyncio.run(publish_to_nostr(url, args.version, sha256, args.accuracy, args.samples, args.privkey))
        if success:
            print('[NOSTR] ✅ Annuncio pubblicato! Gli utenti riceveranno l\'aggiornamento automaticamente.')
        else:
            print('[NOSTR] ⚠ Pubblicazione parzialmente fallita. Controlla la connessione.')
    else:
        print('\n[NOSTR] ⚠ --privkey non specificata, evento Nostr non pubblicato.')
        print('  Per pubblicare su Nostr e distribuire a tutti gli utenti:')
        print(f'  python publish_model.py --onnx {onnx_path} --version {args.version} \\')
        print(f'    --accuracy {args.accuracy} --samples {args.samples} \\')
        print(f'    --url "{url}" --privkey <la-tua-chiave-privata-hex>')

    print('\n' + '=' * 60)
    print('Riepilogo per la community')
    print('=' * 60)
    print(f'  Versione:    {args.version}')
    print(f'  Accuratezza: {args.accuracy * 100:.2f}%')
    print(f'  SHA-256:     {sha256}')
    print(f'  URL:         {url}')
    print()
    if args.accuracy >= 0.90:
        print('  🎉 Modello autonomo! Gli utenti possono smettere di etichettare.')
    elif args.accuracy >= 0.80:
        print('  ✅ Buon modello. Continuate a etichettare per migliorarlo.')
    else:
        print('  📊 Servono ancora dati. Invitate la community a etichettare.')

if __name__ == '__main__':
    main()
