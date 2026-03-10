#!/usr/bin/env python3
"""
M4TR1X - Training del Modello AI Detector

Addestra EfficientNet-B0 sulle etichette raccolte dalla community.
Quando la community ha etichettato abbastanza video, questo script:
  1. Carica il dataset (labels.json + frame)
  2. Fine-tuna EfficientNet-B0 (o lo addestra da zero se non c'è modello base)
  3. Valuta l'accuratezza sul set di test
  4. Esporta il modello in formato ONNX
  5. Stampa le istruzioni per pubblicarlo su Nostr

Uso:
    python train.py --dataset dataset/ --epochs 20 --output ../models/

Requisiti:
    pip install -r requirements.txt
    GPU consigliata (ma funziona anche su CPU, più lento)
"""

import json
import os
import sys
import argparse
import hashlib
import time
from pathlib import Path
from datetime import datetime

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split
from torchvision import transforms
from PIL import Image
import numpy as np
from tqdm import tqdm
from sklearn.metrics import accuracy_score, classification_report
import timm

# ─── Dataset ──────────────────────────────────────────────────────────────────

class M4TR1XDataset(Dataset):
    """Dataset di frame video etichettati dalla community."""

    def __init__(self, entries, transform=None, frame_size=224):
        self.entries   = entries
        self.transform = transform
        self.frame_size = frame_size
        self.samples = self._build_samples()

    def _build_samples(self):
        samples = []
        for entry in self.entries:
            frames_dir = entry.get('frames_dir')
            label_idx  = entry['label_idx']
            weight     = entry.get('confidence', 1.0)  # voti con alta confidenza pesano di più

            if frames_dir and Path(frames_dir).exists():
                frames = sorted(Path(frames_dir).glob('*.jpg'))
                for f in frames:
                    samples.append({'path': str(f), 'label': label_idx, 'weight': weight})
            # Se i frame non ci sono, saltiamo (serve extract_frames)
        return samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        img    = Image.open(sample['path']).convert('RGB')
        if self.transform:
            img = self.transform(img)
        return img, sample['label']

# ─── Trasformazioni ────────────────────────────────────────────────────────────

def get_transforms(frame_size=224):
    """Stessi transform di ai_detector.js (ImageNet normalize)."""
    mean = [0.485, 0.456, 0.406]
    std  = [0.229, 0.224, 0.225]

    train_tf = transforms.Compose([
        transforms.Resize((frame_size, frame_size)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomRotation(10),
        transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
        transforms.ToTensor(),
        transforms.Normalize(mean=mean, std=std),
    ])

    val_tf = transforms.Compose([
        transforms.Resize((frame_size, frame_size)),
        transforms.ToTensor(),
        transforms.Normalize(mean=mean, std=std),
    ])

    return train_tf, val_tf

# ─── Modello ───────────────────────────────────────────────────────────────────

def build_model(num_classes=2, pretrained=True):
    """
    EfficientNet-B0 pre-addestrato su ImageNet, con l'ultimo layer sostituito
    per la classificazione binaria (REAL vs AI_GENERATED).
    """
    model = timm.create_model('efficientnet_b0', pretrained=pretrained, num_classes=num_classes)
    return model

# ─── Training ─────────────────────────────────────────────────────────────────

def train_epoch(model, loader, optimizer, criterion, device):
    model.train()
    total_loss, correct, total = 0, 0, 0

    for imgs, labels in tqdm(loader, desc='  Training', leave=False):
        imgs, labels = imgs.to(device), labels.to(device)
        optimizer.zero_grad()
        outputs = model(imgs)
        loss    = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        total_loss += loss.item() * imgs.size(0)
        preds       = outputs.argmax(dim=1)
        correct    += (preds == labels).sum().item()
        total      += imgs.size(0)

    return total_loss / total, correct / total

def eval_epoch(model, loader, criterion, device):
    model.eval()
    total_loss, all_preds, all_labels = 0, [], []

    with torch.no_grad():
        for imgs, labels in tqdm(loader, desc='  Validazione', leave=False):
            imgs, labels = imgs.to(device), labels.to(device)
            outputs = model(imgs)
            loss    = criterion(outputs, labels)
            total_loss += loss.item() * imgs.size(0)
            preds = outputs.argmax(dim=1)
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())

    acc = accuracy_score(all_labels, all_preds)
    return total_loss / max(len(all_labels), 1), acc, all_preds, all_labels

# ─── Export ONNX ───────────────────────────────────────────────────────────────

def export_onnx(model, output_path, frame_size=224, device='cpu'):
    """Esporta il modello in formato ONNX compatibile con onnxruntime-node."""
    model.eval()
    model.to(device)

    # Input di esempio (batch=1, 3 canali, frame_size x frame_size)
    dummy = torch.randn(1, 3, frame_size, frame_size).to(device)

    torch.onnx.export(
        model,
        dummy,
        output_path,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=['frame'],
        output_names=['prediction'],
        dynamic_axes={
            'frame':      {0: 'batch_size'},
            'prediction': {0: 'batch_size'},
        },
    )
    print(f'[EXPORT] Modello ONNX salvato: {output_path}')

    # Calcola SHA-256 del file per la verifica d'integrità
    with open(output_path, 'rb') as f:
        sha256 = hashlib.sha256(f.read()).hexdigest()

    print(f'[EXPORT] SHA-256: {sha256}')
    return sha256

# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='M4TR1X — Training modello AI detector')
    parser.add_argument('--dataset',    required=True,  help='Cartella dataset (con labels.json e frames/)')
    parser.add_argument('--output',     default='../models', help='Cartella output modello')
    parser.add_argument('--epochs',     type=int, default=20,  help='Numero epoche (default: 20)')
    parser.add_argument('--batch-size', type=int, default=32,  help='Batch size (default: 32)')
    parser.add_argument('--lr',         type=float, default=1e-4, help='Learning rate (default: 0.0001)')
    parser.add_argument('--frame-size', type=int, default=224, help='Dimensione frame (default: 224)')
    parser.add_argument('--val-split',  type=float, default=0.2, help='% dataset per validazione (default: 0.2)')
    parser.add_argument('--no-pretrained', action='store_true', help='Non usare pesi ImageNet pre-addestrati')
    parser.add_argument('--version',    default=None, help='Versione modello (default: auto da timestamp)')
    args = parser.parse_args()

    device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
    print('=' * 60)
    print('M4TR1X — Training Modello AI Detector')
    print('=' * 60)
    print(f'  Device:     {device}')
    print(f'  Epoche:     {args.epochs}')
    print(f'  Batch size: {args.batch_size}')
    print(f'  LR:         {args.lr}')
    print(f'  Dataset:    {args.dataset}')
    if device == 'cpu':
        print('  ⚠ CPU mode: il training sarà lento. Considera una GPU.')
    print()

    # Carica labels
    labels_path = Path(args.dataset) / 'labels.json'
    if not labels_path.exists():
        print(f'[ERROR] {labels_path} non trovato. Esegui prima: python collect_labels.py --extract-frames')
        sys.exit(1)

    with open(labels_path) as f:
        entries = json.load(f)

    # Filtra solo quelli con frame disponibili
    entries_with_frames = [e for e in entries if e.get('frames_dir') and Path(e['frames_dir']).exists()]
    print(f'[DATA] {len(entries)} etichette totali, {len(entries_with_frames)} con frame disponibili.')

    if len(entries_with_frames) < 50:
        print('[ERROR] Troppo pochi campioni con frame. Servono almeno 50.')
        print('  Esegui: python collect_labels.py --extract-frames')
        sys.exit(1)

    # Dataset e split train/val
    train_tf, val_tf = get_transforms(args.frame_size)
    full_dataset = M4TR1XDataset(entries_with_frames, transform=train_tf, frame_size=args.frame_size)

    n_val   = int(len(full_dataset) * args.val_split)
    n_train = len(full_dataset) - n_val
    train_ds, val_ds = random_split(full_dataset, [n_train, n_val])
    val_ds.dataset.transform = val_tf  # usa transform senza augmentation per la val

    print(f'[DATA] Train: {n_train} campioni, Val: {n_val} campioni')

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,  num_workers=2, pin_memory=(device != 'cpu'))
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=(device != 'cpu'))

    # Modello
    print(f'\n[MODEL] Carico EfficientNet-B0 (pretrained={not args.no_pretrained})...')
    model = build_model(num_classes=2, pretrained=not args.no_pretrained)
    model = model.to(device)

    # Bilanciamento classi (se dataset sbilanciato)
    real_count = sum(1 for e in entries_with_frames if e['label'] == 'REAL')
    ai_count   = sum(1 for e in entries_with_frames if e['label'] == 'AI_GENERATED')
    total      = real_count + ai_count
    # peso inversamente proporzionale alla frequenza
    weights = torch.tensor([total / (2 * max(real_count, 1)), total / (2 * max(ai_count, 1))]).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights)

    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    # Training loop
    best_val_acc  = 0.0
    best_model_state = None
    history = []

    print(f'\n[TRAIN] Inizio training per {args.epochs} epoche...\n')

    for epoch in range(1, args.epochs + 1):
        t0 = time.time()
        train_loss, train_acc = train_epoch(model, train_loader, optimizer, criterion, device)
        val_loss, val_acc, val_preds, val_labels = eval_epoch(model, val_loader, criterion, device)
        scheduler.step()
        elapsed = time.time() - t0

        print(f'  Epoca {epoch:3d}/{args.epochs}  '
              f'train_loss={train_loss:.4f}  train_acc={train_acc:.3f}  '
              f'val_loss={val_loss:.4f}  val_acc={val_acc:.3f}  '
              f'({elapsed:.1f}s)')

        history.append({'epoch': epoch, 'train_loss': train_loss, 'train_acc': train_acc,
                        'val_loss': val_loss, 'val_acc': val_acc})

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_model_state = {k: v.clone() for k, v in model.state_dict().items()}
            print(f'  ✅ Nuovo miglior modello: val_acc={best_val_acc:.4f}')

    # Report finale
    print(f'\n[RESULT] Miglior accuratezza di validazione: {best_val_acc:.4f} ({best_val_acc * 100:.2f}%)')

    model.load_state_dict(best_model_state)
    _, final_acc, final_preds, final_labels = eval_epoch(model, val_loader, criterion, device)
    print('\n[RESULT] Classification Report:')
    print(classification_report(final_labels, final_preds, target_names=['REAL', 'AI_GENERATED']))

    # Salva
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    onnx_path = out_dir / 'm4tr1x_detector.onnx'
    sha256 = export_onnx(model, str(onnx_path), frame_size=args.frame_size, device='cpu')

    # Genera versione
    version = args.version or datetime.now().strftime('%Y.%m.%d.%H%M')
    version_info = {
        'version':       version,
        'accuracy':      round(best_val_acc, 4),
        'samples':       len(entries_with_frames),
        'epochs':        args.epochs,
        'frame_size':    args.frame_size,
        'backbone':      'EfficientNet-B0',
        'trained_at':    datetime.now().isoformat(),
        'sha256':        sha256,
        'history':       history,
    }

    with open(out_dir / 'version.json', 'w') as f:
        json.dump(version_info, f, indent=2)

    print(f'\n[DONE] Modello salvato in: {onnx_path}')
    print(f'       Versione: {version}')
    print(f'       Accuratezza: {best_val_acc * 100:.2f}%')
    print(f'       SHA-256: {sha256}')
    print()

    # Istruzioni per la pubblicazione
    print('=' * 60)
    print('PROSSIMO PASSO: Pubblica il modello')
    print('=' * 60)
    print()
    print('  Carica il file ONNX su IPFS o qualsiasi hosting e poi esegui:')
    print()
    print(f'  python publish_model.py \\')
    print(f'    --onnx {onnx_path} \\')
    print(f'    --version {version} \\')
    print(f'    --accuracy {best_val_acc:.4f} \\')
    print(f'    --samples {len(entries_with_frames)}')
    print()

    if best_val_acc >= 0.90:
        print('  🎉 Accuratezza ≥ 90% — il modello è pronto per la distribuzione!')
    elif best_val_acc >= 0.80:
        print('  ✅ Accuratezza ≥ 80% — buono, ma più dati potrebbero migliorarlo.')
    else:
        print('  ⚠ Accuratezza < 80% — servono più etichette o più epoche.')
        print('    Considera: più dati (--sync-nostr), più epoche (--epochs 50)')

if __name__ == '__main__':
    main()
