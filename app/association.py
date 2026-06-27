"""
Person–object association for the littering pipeline.

Call Associator.update(frame_idx, detections) once per frame with the output of
detect_and_track().  Query per-object state via .object_states[track_id].

Ownership rules
---------------
- An object whose center sits inside a person bbox for CARRY_FRAMES consecutive
  frames gets that person as its confirmed owner.
- Hysteresis: once owned, ownership survives HYSTERESIS_FRAMES frames of
  non-overlap before being officially dropped.  This tolerates brief occlusion and
  box jitter without false separations.
- On separation (hysteresis exhausted): dropped_at and drop_location are recorded.
  The abandonment stage reads these fields.
- Re-pickup: if a separated object re-enters a person bbox it goes through the
  carry trial again.  dropped_at is cleared so only the most-recent drop matters.
"""

from typing import Dict, List, Optional, Tuple

CARRY_FRAMES = 5       # consecutive overlap frames to confirm ownership
HYSTERESIS_FRAMES = 20 # frames of grace period after overlap ends (~1-2 s at 10 fps)


class ObjectState:
    __slots__ = (
        "owner_id", "is_carried", "dropped_at", "drop_location",
        "_candidate", "_overlap_count", "_hysteresis",
    )

    def __init__(self) -> None:
        self.owner_id: Optional[int] = None
        self.is_carried: bool = False
        self.dropped_at: Optional[int] = None
        self.drop_location: Optional[Tuple[int, int]] = None
        self._candidate: Optional[int] = None
        self._overlap_count: int = 0
        self._hysteresis: int = 0


class Associator:
    """Stateful per-session associator; one instance lives for the whole video run."""

    def __init__(
        self,
        carry_frames: int = CARRY_FRAMES,
        hysteresis_frames: int = HYSTERESIS_FRAMES,
    ) -> None:
        self.carry_frames = carry_frames
        self.hysteresis_frames = hysteresis_frames
        self.object_states: Dict[int, ObjectState] = {}

    def update(self, frame_idx: int, detections: List[dict]) -> None:
        """Advance state for one frame.  detections is the raw list from detect_and_track."""
        persons = {
            d["track_id"]: d["bbox"]
            for d in detections
            if d["class"] == "person" and d.get("track_id") is not None
        }
        objects = [
            d for d in detections
            if d["class"] != "person" and d.get("track_id") is not None
        ]

        for obj in objects:
            oid: int = obj["track_id"]
            bbox: Tuple[int, int, int, int] = obj["bbox"]
            state = self.object_states.setdefault(oid, ObjectState())

            overlapping = _overlapping_person(bbox, persons)

            if overlapping is not None:
                # --- object is near/inside a person ---
                state._hysteresis = self.hysteresis_frames

                if state.is_carried:
                    pass  # already owned, stay carried
                else:
                    # Trial: accumulate overlap with the same candidate
                    if state._candidate == overlapping:
                        state._overlap_count += 1
                    else:
                        state._candidate = overlapping
                        state._overlap_count = 1

                    if state._overlap_count >= self.carry_frames:
                        state.owner_id = overlapping
                        state.is_carried = True
                        state._candidate = None
                        state._overlap_count = 0
                        # Clear any previous drop record (object was re-acquired)
                        state.dropped_at = None
                        state.drop_location = None

            else:
                # --- object is not overlapping any person ---
                if state.is_carried:
                    state._hysteresis -= 1
                    if state._hysteresis <= 0:
                        # Grace period exhausted → officially separated
                        state.is_carried = False
                        cx = (bbox[0] + bbox[2]) // 2
                        cy = (bbox[1] + bbox[3]) // 2
                        state.dropped_at = frame_idx
                        state.drop_location = (cx, cy)
                else:
                    # Not yet owned; reset trial if we lose overlap mid-trial
                    state._candidate = None
                    state._overlap_count = 0


def _overlapping_person(
    obj_bbox: Tuple[int, int, int, int],
    persons: Dict[int, Tuple[int, int, int, int]],
) -> Optional[int]:
    """
    Return the person track_id whose bbox best contains the object, or None.

    Primary test: object center inside person bbox (robust for held objects).
    Fallback: object bbox overlaps person bbox by ≥30 % of the object's area.
    When multiple persons qualify, prefer the one with the largest bbox (nearest).
    """
    ox1, oy1, ox2, oy2 = obj_bbox
    ocx = (ox1 + ox2) // 2
    ocy = (oy1 + oy2) // 2

    best_id: Optional[int] = None
    best_area = 0

    for pid, (px1, py1, px2, py2) in persons.items():
        if px1 <= ocx <= px2 and py1 <= ocy <= py2:
            area = (px2 - px1) * (py2 - py1)
            if area > best_area:
                best_area = area
                best_id = pid

    if best_id is not None:
        return best_id

    # Fallback: significant bbox overlap
    obj_area = max((ox2 - ox1) * (oy2 - oy1), 1)
    for pid, (px1, py1, px2, py2) in persons.items():
        ix1, iy1 = max(ox1, px1), max(oy1, py1)
        ix2, iy2 = min(ox2, px2), min(oy2, py2)
        if ix2 > ix1 and iy2 > iy1:
            if (ix2 - ix1) * (iy2 - iy1) / obj_area >= 0.30:
                return pid

    return None
