"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { loadModels, activeBackend } from "@/lib/inference";
import type { Detection } from "@/lib/yoloDecode";
import type { EvidenceEvent } from "@/lib/evidence";
import EventsPanel from "@/components/EventsPanel";
import LiveDetections, { type LiveDetectionsHandle } from "@/components/LiveDetections";
import ModelStatusBadge from "@/components/ModelStatusBadge";

const MAX_EVENTS = 50;

// WebcamCanvas uses browser APIs — disable SSR entirely
const WebcamCanvas = dynamic(() => import("@/components/WebcamCanvas"), {
  ssr: false,
});

export default function DemoPage() {
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");
  const [events, setEvents] = useState<EvidenceEvent[]>([]);
  const liveRef = useRef<LiveDetectionsHandle>(null);

  function handleEvent(event: EvidenceEvent) {
    setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
  }

  // Stable callback — pushes detections straight to the DOM via the ref handle,
  // so per-frame updates never re-render this page.
  const handleDetections = useCallback((dets: Detection[]) => {
    liveRef.current?.update(dets);
  }, []);

  useEffect(() => {
    loadModels()
      .then(() => {
        console.info("[inference] backend:", activeBackend);
        setModelState("ready");
      })
      .catch((err) => {
        console.error("Model load failed:", err);
        setModelState("error");
      });
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, 'Segoe UI', sans-serif",
      }}
    >
      {/* Header */}
      <header
        style={{
          background: "var(--card)",
          borderBottom: "1px solid var(--border)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--accent)",
              margin: 0,
            }}
          >
            GuardAI
          </h1>
          <span style={{ color: "var(--border)" }}>|</span>
          <ModelStatusBadge state={modelState} />
        </div>
        <Link
          href="/cameras"
          style={{
            fontSize: 13,
            color: "var(--muted)",
            textDecoration: "none",
          }}
        >
          View all cameras &rarr;
        </Link>
      </header>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 300px",
          gridTemplateRows: "1fr",
          gap: 16,
          padding: 16,
          minHeight: 0,
        }}
      >
        {/* Webcam area */}
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
            position: "relative",
            minHeight: 400,
          }}
        >
          {modelState === "loading" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                color: "var(--muted)",
                fontSize: 14,
                background: "var(--card)",
                zIndex: 10,
              }}
            >
              <LoadingSpinner />
              <span>Loading models&hellip;</span>
              <span style={{ fontSize: 11, color: "#555" }}>
                First load may take 10–20s
              </span>
            </div>
          )}

          {modelState === "error" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "var(--red)",
                fontSize: 14,
                background: "var(--card)",
                zIndex: 10,
              }}
            >
              <span style={{ fontSize: 24 }}>&#9888;</span>
              <span>Failed to load models</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Check console for details
              </span>
            </div>
          )}

          {/* Render webcam once models are ready */}
          {modelState === "ready" && (
            <WebcamCanvas onDetections={handleDetections} onEvent={handleEvent} />
          )}
        </div>

        {/* Right column: live detections (imperative) + saved events feed */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          <LiveDetections ref={liveRef} />
          <EventsPanel events={events} live={modelState === "ready"} />
        </div>
      </main>

      <style>{`
        @media (max-width: 900px) {
          main {
            grid-template-columns: 1fr !important;
            grid-template-rows: auto auto !important;
          }
        }
      `}</style>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        border: "3px solid var(--border)",
        borderTop: "3px solid var(--accent)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
