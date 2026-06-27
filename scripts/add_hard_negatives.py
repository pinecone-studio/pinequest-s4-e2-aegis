"""
Add hard-negative images to the smoking training set (no smoking labels).

Use for false-positive cases the model must learn to ignore:
  - white wooden toy cigarettes in mouth
  - red LED / indicator lights near the face
  - other non-smoking mouth objects

Usage:
  python scripts/add_hard_negatives.py path/to/images/
  python scripts/add_hard_negatives.py models/hard-negatives/

Each image is copied into models/smoking-dataset/train/images with an empty label file.
"""

import argparse
import shutil
import sys
from pathlib import Path

DATASET_TRAIN_IMAGES = Path("models/smoking-dataset/train/images")
DATASET_TRAIN_LABELS = Path("models/smoking-dataset/train/labels")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def add_negatives(source_dir: Path) -> int:
    if not DATASET_TRAIN_IMAGES.exists():
        sys.exit(f"Training set not found: {DATASET_TRAIN_IMAGES}. Run train_model.py download first.")

    if not source_dir.is_dir():
        sys.exit(f"Not a directory: {source_dir}")

    DATASET_TRAIN_LABELS.mkdir(parents=True, exist_ok=True)
    added = 0

    for src in sorted(source_dir.iterdir()):
        if src.suffix.lower() not in IMAGE_EXTS:
            continue

        stem = f"neg_{src.stem}"
        dest_img = DATASET_TRAIN_IMAGES / f"{stem}{src.suffix.lower()}"
        dest_lbl = DATASET_TRAIN_LABELS / f"{stem}.txt"

        if dest_img.exists():
            print(f"skip (exists): {dest_img.name}")
            continue

        shutil.copy2(src, dest_img)
        dest_lbl.write_text("")
        added += 1
        print(f"added: {src.name} -> {dest_img.name}")

    print(f"\nAdded {added} hard-negative image(s) to training set.")
    return added


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add hard-negative images to smoking training set")
    parser.add_argument("source_dir", type=Path, help="Folder of images with no smoking")
    args = parser.parse_args()
    add_negatives(args.source_dir)
