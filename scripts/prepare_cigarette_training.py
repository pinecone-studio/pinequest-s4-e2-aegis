"""
Import tight cigarette-box training data (no smoke plume expansion).

  models/custom-smoking/positive/  — person holding cigarette (with .txt labels)
  models/custom-smoking/negative/  — not smoking

Removes prior expanded smoke imports (custom_smoke_*) and adds tight labels.

Usage:
  python scripts/prepare_cigarette_training.py --auto-label
  python scripts/prepare_cigarette_training.py --force --auto-label
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SMOKING_CLASS = 1

ROOT = Path(__file__).resolve().parents[1]
POSITIVE_DIR = ROOT / "models" / "custom-smoking" / "positive"
NEGATIVE_DIR = ROOT / "models" / "custom-smoking" / "negative"
TRAIN_IMAGES = ROOT / "models" / "smoking-dataset" / "train" / "images"
TRAIN_LABELS = ROOT / "models" / "smoking-dataset" / "train" / "labels"
WEIGHTS = ROOT / "models" / "smoking.pt"


def purge_expanded_smoke_imports() -> int:
    removed = 0
    for folder in (TRAIN_IMAGES, TRAIN_LABELS):
        for path in folder.glob("custom_smoke*"):
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def parse_label_lines(content: str) -> list[tuple[int, float, float, float, float]]:
    rows: list[tuple[int, float, float, float, float]] = []
    for line in content.splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        rows.append((int(parts[0]), float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])))
    return rows


def format_label_lines(rows: list[tuple[int, float, float, float, float]]) -> str:
    lines = [f"{cls_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}" for cls_id, cx, cy, w, h in rows]
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
        if cls_id == SMOKING_CLASS and w * h > 0.08:
            continue
        rows.append((cls_id, cx, cy, w, h))
    return format_label_lines(rows)


def import_folder(
    folder: Path,
    prefix: str,
    model,
    auto_label_flag: bool,
    force: bool,
    require_smoking: bool,
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
            continue

        label_path = img.with_suffix(".txt")
        if label_path.exists():
            content = format_label_lines(parse_label_lines(label_path.read_text()))
        elif auto_label_flag and model is not None:
            content = auto_label(model, img)
            if not content.strip():
                print(f"  skip (no boxes): {img.name}")
                continue
        elif require_smoking:
            print(f"  skip (no label): {img.name}")
            continue
        else:
            content = ""

        if require_smoking and not any(line.startswith(f"{SMOKING_CLASS} ") for line in content.splitlines()):
            print(f"  skip (no class-1): {img.name}")
            continue

        shutil.copy2(img, dest_img)
        dest_lbl.write_text(content)
        print(f"  added: {img.name}")
        added += 1

    return added


def main() -> None:
    parser = argparse.ArgumentParser(description="Import tight cigarette-box training images")
    parser.add_argument("--auto-label", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if not TRAIN_IMAGES.parent.parent.exists():
        sys.exit("Dataset missing. Run: python scripts/train_model.py")

    TRAIN_IMAGES.mkdir(parents=True, exist_ok=True)
    TRAIN_LABELS.mkdir(parents=True, exist_ok=True)

    removed = purge_expanded_smoke_imports()
    if removed:
        print(f"Removed {removed} expanded smoke import file(s)")

    model = None
    if args.auto_label:
        if not WEIGHTS.exists():
            sys.exit(f"Weights not found: {WEIGHTS}")
        from ultralytics import YOLO

        model = YOLO(str(WEIGHTS))

    pos = import_folder(POSITIVE_DIR, "custom_cig_", model, args.auto_label, args.force, True)
    neg = import_folder(NEGATIVE_DIR, "custom_cigneg_", model, False, args.force, False)

    print(f"\nImported {pos} tight-positive + {neg} negative image(s).")


if __name__ == "__main__":
    main()
