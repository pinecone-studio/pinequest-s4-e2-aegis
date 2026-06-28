"""
Prepare smoke-aware training labels and import into smoking-dataset/train.

Drop images with visible cigarette smoke into:
  models/custom-smoking/smoke/

Each image should show smoke rising from a cigarette. Labels are auto-generated
from models/smoking.pt, then expanded upward to include the smoke plume.

Also re-imports models/custom-smoking/positive/ with expanded smoke boxes.

Usage:
  python scripts/prepare_smoke_training.py
  python scripts/prepare_smoke_training.py --auto-label
  python scripts/prepare_smoke_training.py --force   # overwrite prior imports
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SMOKING_CLASS = 1

ROOT = Path(__file__).resolve().parents[1]
SMOKE_DIR = ROOT / "models" / "custom-smoking" / "smoke"
POSITIVE_DIR = ROOT / "models" / "custom-smoking" / "positive"
TRAIN_IMAGES = ROOT / "models" / "smoking-dataset" / "train" / "images"
TRAIN_LABELS = ROOT / "models" / "smoking-dataset" / "train" / "labels"
WEIGHTS = ROOT / "models" / "smoking.pt"


def expand_smoking_box(cx: float, cy: float, w: float, h: float) -> tuple[float, float, float, float]:
    """Expand a tight cigarette box to cover cigarette + rising smoke."""
    new_w = min(0.92, w * 1.6)
    new_h = min(0.92, h * 3.2)
    new_cy = max(new_h / 2, cy - h * 1.1)
    new_cx = min(max(cx, new_w / 2), 1 - new_w / 2)
    new_cy = min(max(new_cy, new_h / 2), 1 - new_h / 2)
    return new_cx, new_cy, new_w, new_h


def parse_label_lines(content: str) -> list[tuple[int, float, float, float, float]]:
    rows: list[tuple[int, float, float, float, float]] = []
    for line in content.splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        cls_id = int(parts[0])
        rows.append((cls_id, float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])))
    return rows


def format_label_lines(rows: list[tuple[int, float, float, float, float]]) -> str:
    lines: list[str] = []
    for cls_id, cx, cy, w, h in rows:
        if cls_id == SMOKING_CLASS:
            cx, cy, w, h = expand_smoking_box(cx, cy, w, h)
        lines.append(f"{cls_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return "\n".join(lines) + ("\n" if lines else "")


def auto_label(model, image: Path) -> str:
    results = model.predict(str(image), conf=0.15, verbose=False)[0]
    rows: list[tuple[int, float, float, float, float]] = []
    if results.boxes is None:
        return ""
    for box in results.boxes:
        cls_id = int(box.cls[0])
        if cls_id not in (0, SMOKING_CLASS):
            continue
        cx, cy, w, h = box.xywhn[0].tolist()
        rows.append((cls_id, cx, cy, w, h))
    return format_label_lines(rows)


def import_folder(
    folder: Path,
    prefix: str,
    model,
    auto_label_flag: bool,
    force: bool,
) -> int:
    folder.mkdir(parents=True, exist_ok=True)
    added = 0

    for img in sorted(folder.iterdir()):
        if img.suffix.lower() not in IMAGE_EXTS:
            continue

        stem = f"{prefix}{img.stem}"
        dest_img = TRAIN_IMAGES / f"{stem}{img.suffix.lower()}"
        dest_lbl = TRAIN_LABELS / f"{stem}.txt"

        if dest_img.exists() and not force:
            print(f"  skip (exists): {dest_img.name}")
            continue

        label_path = img.with_suffix(".txt")
        if label_path.exists():
            content = format_label_lines(parse_label_lines(label_path.read_text()))
        elif auto_label_flag and model is not None:
            content = auto_label(model, img)
            if not content.strip():
                print(f"  skip (no boxes): {img.name}")
                continue
        else:
            print(f"  skip (no label): {img.name}")
            continue

        if not any(line.startswith(f"{SMOKING_CLASS} ") for line in content.splitlines()):
            print(f"  skip (no class-1): {img.name}")
            continue

        shutil.copy2(img, dest_img)
        dest_lbl.write_text(content)
        print(f"  added: {img.name} -> {dest_img.name}")
        added += 1

    return added


def main() -> None:
    parser = argparse.ArgumentParser(description="Import smoke-focused training images")
    parser.add_argument("--auto-label", action="store_true", help="Auto-label with models/smoking.pt")
    parser.add_argument("--force", action="store_true", help="Overwrite existing imports")
    parser.add_argument("--skip-positive", action="store_true", help="Only import smoke/ folder")
    args = parser.parse_args()

    if not TRAIN_IMAGES.parent.parent.exists():
        sys.exit("Dataset missing. Run: python scripts/train_model.py")

    TRAIN_IMAGES.mkdir(parents=True, exist_ok=True)
    TRAIN_LABELS.mkdir(parents=True, exist_ok=True)
    SMOKE_DIR.mkdir(parents=True, exist_ok=True)

    model = None
    if args.auto_label:
        if not WEIGHTS.exists():
            sys.exit(f"Weights not found: {WEIGHTS}")
        from ultralytics import YOLO

        model = YOLO(str(WEIGHTS))

    smoke_images = [p for p in SMOKE_DIR.iterdir() if p.suffix.lower() in IMAGE_EXTS]
    print(f"Smoke folder: {len(smoke_images)} image(s) at {SMOKE_DIR}")

    smoke_added = import_folder(SMOKE_DIR, "custom_smoke_", model, args.auto_label, args.force)

    pos_added = 0
    if not args.skip_positive:
        pos_added = import_folder(POSITIVE_DIR, "custom_smokepos_", model, args.auto_label, args.force)

    print(f"\nImported {smoke_added} smoke + {pos_added} expanded-positive image(s).")
    if smoke_added == 0:
        print("\nAdd webcam photos with visible smoke to:")
        print(f"  {SMOKE_DIR}")
        print("Then run: python scripts/prepare_smoke_training.py --auto-label")


if __name__ == "__main__":
    main()
