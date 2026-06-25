"use client";

import { ACTIVE_MODEL } from "@/lib/modelConfig";

interface Props {
  state: "loading" | "ready" | "error";
}

export default function ModelStatusBadge({ state }: Props) {
  const dot = {
    loading: { color: "#888", label: "Loading" },
    ready:   { color: "#22c55e", label: "Ready" },
    error:   { color: "#ef4444", label: "Error" },
  }[state];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "3px 10px",
        fontSize: 11,
        color: "var(--muted)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dot.color,
          flexShrink: 0,
          boxShadow: state === "ready" ? `0 0 5px ${dot.color}` : undefined,
        }}
      />
      <span style={{ fontWeight: 600, letterSpacing: "0.04em" }}>
        {ACTIVE_MODEL}
      </span>
      <span style={{ color: "#555" }}>&bull;</span>
      <span>{dot.label}</span>
    </div>
  );
}
