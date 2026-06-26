"use client";

import { useEffect, useMemo, useState } from "react";
import CameraCard from "./CameraCard";
import type { CameraView } from "../lib/cameraTypes";

const MAX_ACTIVE_STREAM_LOADS = 10;

export type StreamLoadState = "not_started" | "loading" | "online" | "stream_unavailable";

function cameraLabel(camera: CameraView, index: number): string {
  return camera.name || `CCTV ${String(index + 1).padStart(2, "0")}`;
}

export default function CameraGrid({
  cameras,
  columns = 2,
  selectedId,
  onSelect,
}: {
  cameras: CameraView[];
  columns?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const loadableCameraIds = useMemo(
    () => cameras.filter((camera) => camera.enabled !== false).map((camera) => camera.id),
    [cameras],
  );
  const [streamStates, setStreamStates] = useState<Record<string, StreamLoadState>>({});

  useEffect(() => {
    setStreamStates((current) => {
      const next: Record<string, StreamLoadState> = {};
      for (const cameraId of loadableCameraIds) {
        next[cameraId] = current[cameraId] ?? "not_started";
      }
      return next;
    });
  }, [loadableCameraIds]);

  useEffect(() => {
    if (loadableCameraIds.length === 0) return;

    setStreamStates((current) => {
      const next = { ...current };
      let changed = false;
      let activeCount = loadableCameraIds.filter((cameraId) => next[cameraId] === "loading").length;

      for (const cameraId of loadableCameraIds) {
        if (activeCount >= MAX_ACTIVE_STREAM_LOADS) break;
        if ((next[cameraId] ?? "not_started") !== "not_started") continue;

        next[cameraId] = "loading";
        activeCount += 1;
        changed = true;
      }

      return changed ? next : current;
    });
  }, [loadableCameraIds, streamStates]);

  if (cameras.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          aspectRatio: "16 / 9",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--muted)",
          fontSize: 13,
        }}
      >
        No cameras configured
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 14,
      }}
    >
      {cameras.map((camera, index) => (
        <CameraCard
          key={camera.id}
          camera={camera}
          label={cameraLabel(camera, index)}
          selected={selectedId === camera.id}
          onSelect={onSelect ? () => onSelect(camera.id) : undefined}
          streamState={streamStates[camera.id] ?? "not_started"}
          onStreamSettled={(state) => {
            setStreamStates((current) => {
              if (current[camera.id] === state) return current;
              return { ...current, [camera.id]: state };
            });
          }}
        />
      ))}
    </div>
  );
}
