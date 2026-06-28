"""
Copy smoke-heavy images from the Roboflow training set into models/custom-smoking/smoke/.

Picks images whose class-1 (smoking) box is tall or large — often includes visible smoke.

Usage:
  python scripts/harvest_smoke_images.py
  python scripts/harvest_smoke_images.py --limit 60
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRAIN_IMAGES = ROOT / "models" / "smoking-dataset" / "train" / "images"
TRAIN_LABELS = ROOT / "models" / "smoking-dataset" / "train" / "labels"
SMOKE_DIR = ROOT / "models" / "custom-smoking" / "smoke"
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


def score_label(lines: list[str]) -> float:
    best = 0.0
    for line in lines:
        parts = line.strip().split()
        if len(parts) != 5 or parts[0] != "1":
            continue
        _, _cx, _cy, w, h = map(float, parts)
        area = w * h
        best = max(best, area + (h * 1.5 if h > 0.08 else 0))
    return best


def find_image(stem: str) -> Path | None:
    for ext in IMAGE_EXTS:
        path = TRAIN_IMAGES / f"{stem}{ext}"
        if path.exists():
            return path
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=40)
    args = parser.parse_args()

    SMOKE_DIR.mkdir(parents=True, exist_ok=True)
    candidates: list[tuple[float, Path, Path]] = []

    for lbl in TRAIN_LABELS.glob("*.txt"):
        if lbl.stem.startswith(("custom_smoke_", "custom_smokepos_", "custom_neg_")):
            continue
        lines = lbl.read_text().splitlines()
        score = score_label(lines)
        if score < 0.004:
            continue
        img = find_image(lbl.stem)
        if img:
            candidates.append((score, img, lbl))

    candidates.sort(key=lambda x: x[0], reverse=True)
    added = 0
    seen: set[str] = set()

    for _score, img, lbl in candidates[: args.limit]:
        if img.name in seen:
            continue
        seen.add(img.name)
        dest_img = SMOKE_DIR / img.name
        dest_lbl = dest_img.with_suffix(".txt")
        if dest_img.exists():
            continue
        shutil.copy2(img, dest_img)
        shutil.copy2(lbl, dest_lbl)
        added += 1

    print(f"Harvested {added} image(s) into {SMOKE_DIR}")
    if added:
        print("Run: python scripts/prepare_smoke_training.py --force")


if __name__ == "__main__":
    main()
