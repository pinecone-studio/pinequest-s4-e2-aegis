"""
Shared frame-level detector using COCO weights.
Loads the model once at import time; designed so a tracker can consume
the returned list in a later pipeline stage.
"""

from pathlib import Path
from typing import List, Dict

import numpy as np
import torch
from ultralytics import YOLO

# ── model ──────────────────────────────────────────────────────────────────────
# yolo11s: YOLO11 Small, COCO-pretrained.  mAP50-95 ≈ 47 vs 39 for nano.
# Switch back to coco.pt (nano) if FPS is too low on your hardware.
_WEIGHTS = Path(__file__).parent.parent / "training" / "checkpoints" / "yolo11s.pt"
_TRACKER = str(Path(__file__).parent.parent / "training" / "checkpoints" / "bytetrack_littering.yaml")

# ── confidence thresholds (tune here) ─────────────────────────────────────────
CONF_PERSON = 0.30   # person is well-detected; keep the original threshold
CONF_OBJECT = 0.25   # lower threshold for carriable objects (bottles flicker at ~0.3)

_COCO_FILTER = {"person", "bottle", "cup", "backpack", "handbag", "suitcase"}

_device = "mps" if torch.backends.mps.is_available() else "cpu"

if not _WEIGHTS.exists():
    raise FileNotFoundError(f"COCO weights not found at {_WEIGHTS}")

_model = YOLO(str(_WEIGHTS))


def _conf_threshold(cls_name: str) -> float:
    return CONF_PERSON if cls_name == "person" else CONF_OBJECT


def detect_frame(frame: np.ndarray) -> List[Dict]:
    """
    Run inference on a single BGR frame.

    Returns a list of dicts: {class, bbox (x1,y1,x2,y2), conf}.
    Filtered to _COCO_FILTER classes only with per-class thresholds.
    """
    results = _model(frame, verbose=False, device=_device)[0]
    detections: List[Dict] = []
    if results.boxes is None:
        return detections

    names = results.names
    for box in results.boxes:
        conf = float(box.conf[0])
        cls_name = names[int(box.cls[0])]
        if cls_name not in _COCO_FILTER or conf < _conf_threshold(cls_name):
            continue
        x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
        detections.append({"class": cls_name, "bbox": (x1, y1, x2, y2), "conf": conf})

    return detections


def detect_and_track(frame: np.ndarray) -> List[Dict]:
    """
    Run inference + ByteTrack on a single BGR frame.

    Returns a list of dicts: {class, bbox (x1,y1,x2,y2), conf, track_id}.
    track_id is an int when the tracker has assigned one, or None on first appearance.
    Filtered to _COCO_FILTER classes only with per-class thresholds.

    Call with the same model instance across frames (guaranteed here via module-level
    _model) so persist=True carries state between calls.
    """
    results = _model.track(
        frame, persist=True, tracker=_TRACKER,
        verbose=False, device=_device,
    )[0]
    detections: List[Dict] = []
    if results.boxes is None:
        return detections

    names = results.names
    for box in results.boxes:
        conf = float(box.conf[0])
        cls_name = names[int(box.cls[0])]
        if cls_name not in _COCO_FILTER or conf < _conf_threshold(cls_name):
            continue
        x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
        track_id = int(box.id[0]) if box.id is not None else None
        detections.append({
            "class": cls_name,
            "bbox": (x1, y1, x2, y2),
            "conf": conf,
            "track_id": track_id,
        })

    return detections
