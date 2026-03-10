#!/usr/bin/env python3
"""
M4TR1X - Raccolta Etichette da Nostr e API locale

Scarica le etichette confermate dalla community (dal DB locale o dai relay Nostr)
e le prepara come dataset per il training.

Uso:
    python collect_labels.py --output dataset/ --min-votes 10 --agreement 0.7

Output:
    dataset/
        labels.json        — lista di { video_hash, label, confidence, votes }
        frames/            — frame estratti dai video (se --extract-frames)
        dataset_info.json  — statistiche del dataset
"""

import json
import os
import sys
import argparse
import asyncio
import hashlib
import subprocess
from pathlib import Path
from datetime import datetime

import requests

# ─── Configurazione ────────────────────────────────────────────────────────────

API_BASE    = os.environ.get('M4TR1X_API', 'http://localhost:8080')
API_KEY     = os.environ.get('M4TR1X_API_KEY', '')
NOSTR_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://relay.snort.social',
    'wss://nostr.wine',
]

# ─── Client API locale ─────────────────────────────────────────────────────────

def api_get(endpoint, params=None):
    headers = {'X-API-Key': API_KEY} if API_KEY else {}
    r = requests.get(f'{API_BASE}{endpoint}', headers=headers, params=params, timeout=30)
    r.raise_for_status()
    return r.json()

def api_post(endpoint, data=None):
    headers = {'X-API-Key': API_KEY, 'Content-Type': 'application/json'} if API_KEY else {'Content-Type': 'application/json'}
    r = requests.post(f'{API_BASE}{endpoint}', headers=headers, json=data, timeout=30)
    r.raise_for_status()
    return r.json()

# ─── Raccolta etichette ────────────────────────────────────────────────────────

def fetch_confirmed_labels(only_new=False, limit=10000):
    """Recupera le etichette confermate dall'API locale."""
    print(f'[COLLECT] Recupero etichette confermate dall\'API locale...')
    try:
        data = api_get('/api/v1/train/labels', {'only_new': str(only_new).lower(), 'limit': limit})
        print(f'[COLLECT] {len(data)} etichette recuperate.')
        return data
    except Exception as e:
        print(f'[COLLECT] ⚠ Impossibile contattare l\'API locale: {e}')
        print(f'[COLLECT]   Assicurati che M4TR1X sia in esecuzione su {API_BASE}')
        return []

def sync_from_nostr():
    """Sincronizza voti dai relay Nostr tramite l'API locale."""
    print('[COLLECT] Sincronizzazione voti da Nostr...')
    try:
        result = api_post('/api/v1/train/sync')
        print(f'[COLLECT] {result.get("imported", 0)} nuovi voti importati.')
        return result
    except Exception as e:
        print(f'[COLLECT] ⚠ Sync Nostr fallita: {e}')
        return {'imported': 0}

# ─── Estrazione frame ──────────────────────────────────────────────────────────

def extract_frames_for_hash(video_hash, output_dir, num_frames=16, frame_size=224):
    """
    Cerca un video nel DB locale (o nelle uploads) e ne estrae i frame.
    I frame vengono salvati come JPEG in output_dir/{video_hash}/frame_NNN.jpg
    """
    frames_dir = Path(output_dir) / video_hash
    if frames_dir.exists() and len(list(frames_dir.glob('*.jpg'))) >= num_frames:
        print(f'  [FRAMES] Già estratti: {video_hash[:12]}...')
        return True

    # Cerca il video nella cartella uploads dell'app
    uploads_dirs = [
        Path('uploads'),
        Path(os.path.expanduser('~')) / 'AppData' / 'Roaming' / 'm4tr1x' / 'uploads',
        Path(os.path.expanduser('~')) / '.config' / 'm4tr1x' / 'uploads',
        Path('/tmp') / 'm4tr1x_uploads',
    ]

    video_path = None
    for d in uploads_dirs:
        if not d.exists():
            continue
        for f in d.rglob('*'):
            if f.is_file() and f.suffix.lower() in {'.mp4', '.mov', '.avi', '.webm', '.mkv'}:
                # Verifica hash
                sha = hashlib.sha256(f.read_bytes()).hexdigest()
                if sha == video_hash:
                    video_path = f
                    break
        if video_path:
            break

    if not video_path:
        print(f'  [FRAMES] ⚠ Video non trovato per hash {video_hash[:12]}...')
        return False

    frames_dir.mkdir(parents=True, exist_ok=True)

    # Durata video
    probe = subprocess.run([
        'ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_streams', str(video_path)
    ], capture_output=True, text=True)

    duration = 10.0
    try:
        info = json.loads(probe.stdout)
        vs = next((s for s in info.get('streams', []) if s.get('codec_type') == 'video'), None)
        if vs:
            duration = float(vs.get('duration', 10))
    except Exception:
        pass

    # Estrai frame equidistanti
    extracted = 0
    for i in range(num_frames):
        t = (duration * i) / num_frames
        frame_path = frames_dir / f'frame_{i:03d}.jpg'
        result = subprocess.run([
            'ffmpeg', '-ss', f'{t:.3f}', '-i', str(video_path),
            '-vframes', '1', '-vf', f'scale={frame_size}:{frame_size}',
            '-q:v', '2', '-y', str(frame_path)
        ], capture_output=True)
        if frame_path.exists():
            extracted += 1

    print(f'  [FRAMES] {extracted}/{num_frames} frame estratti per {video_hash[:12]}...')
    return extracted > 0

# ─── Costruzione dataset ───────────────────────────────────────────────────────

def build_dataset(labels, output_dir, extract_frames=False, frame_size=224):
    """Costruisce il dataset di training."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    frames_dir = out / 'frames'

    dataset = []
    skipped = 0

    for item in labels:
        video_hash = item['video_hash']
        label      = item['label']         # 'REAL' | 'AI_GENERATED'
        confidence = item.get('confidence', 1.0)
        votes      = item.get('total_votes', 0)

        if label not in ('REAL', 'AI_GENERATED'):
            skipped += 1
            continue

        entry = {
            'video_hash': video_hash,
            'label':      label,
            'label_idx':  0 if label == 'REAL' else 1,  # 0=REAL, 1=AI_GENERATED
            'confidence': confidence,
            'votes':      votes,
            'frames_dir': str(frames_dir / video_hash) if extract_frames else None,
        }

        if extract_frames:
            ok = extract_frames_for_hash(video_hash, frames_dir, frame_size=frame_size)
            if not ok:
                entry['frames_dir'] = None

        dataset.append(entry)

    # Statistiche
    real_count = sum(1 for d in dataset if d['label'] == 'REAL')
    ai_count   = sum(1 for d in dataset if d['label'] == 'AI_GENERATED')

    info = {
        'total':            len(dataset),
        'real':             real_count,
        'ai_generated':     ai_count,
        'skipped':          skipped,
        'balance_ratio':    real_count / max(ai_count, 1),
        'avg_confidence':   sum(d['confidence'] for d in dataset) / max(len(dataset), 1),
        'avg_votes':        sum(d['votes'] for d in dataset) / max(len(dataset), 1),
        'created_at':       datetime.now().isoformat(),
    }

    # Salva
    with open(out / 'labels.json', 'w') as f:
        json.dump(dataset, f, indent=2)

    with open(out / 'dataset_info.json', 'w') as f:
        json.dump(info, f, indent=2)

    return dataset, info

# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='M4TR1X — Raccolta etichette per il training')
    parser.add_argument('--output',         default='dataset',  help='Cartella output (default: dataset/)')
    parser.add_argument('--limit',          type=int, default=10000, help='Max etichette da raccogliere')
    parser.add_argument('--only-new',       action='store_true', help='Solo etichette non ancora usate nel training')
    parser.add_argument('--sync-nostr',     action='store_true', help='Sincronizza voti da Nostr prima di raccogliere')
    parser.add_argument('--extract-frames', action='store_true', help='Estrai frame dai video (richiede ffmpeg)')
    parser.add_argument('--frame-size',     type=int, default=224, help='Dimensione frame (default: 224)')
    args = parser.parse_args()

    print('=' * 60)
    print('M4TR1X — Raccolta Etichette Community')
    print('=' * 60)

    if args.sync_nostr:
        sync_from_nostr()

    labels = fetch_confirmed_labels(only_new=args.only_new, limit=args.limit)

    if not labels:
        print('\n[COLLECT] Nessuna etichetta disponibile.')
        print('[COLLECT] Gli utenti devono votare i video prima che si possa addestrare il modello.')
        sys.exit(1)

    print(f'\n[COLLECT] Costruzione dataset in: {args.output}/')
    dataset, info = build_dataset(
        labels,
        args.output,
        extract_frames=args.extract_frames,
        frame_size=args.frame_size,
    )

    print('\n' + '=' * 60)
    print('DATASET PRONTO')
    print('=' * 60)
    print(f"  Totale:        {info['total']} video")
    print(f"  REAL:          {info['real']}")
    print(f"  AI_GENERATED:  {info['ai_generated']}")
    print(f"  Confidenza media: {info['avg_confidence']:.2f}")
    print(f"  Voti medi:     {info['avg_votes']:.1f}")
    print(f"\n  File salvati in: {args.output}/")
    print(f"    labels.json      — etichette")
    print(f"    dataset_info.json — statistiche")
    if args.extract_frames:
        print(f"    frames/          — frame video")
    print('\nOra esegui: python train.py --dataset', args.output)

if __name__ == '__main__':
    main()
