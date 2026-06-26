"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CameraGrid from "./components/CameraGrid";
import { fetchCameraConfig } from "./lib/cameraApi";
import type { CameraView } from "./lib/cameraTypes";

type LayoutCols = 1 | 2 | 3;

function groupCameras(cameras: CameraView[]) {
  const groups = new Map<string, CameraView[]>();
  for (const camera of cameras) {
    const raw = camera.zone && camera.zone !== "unknown" ? camera.zone : "All Cameras";
    const key = raw.charAt(0).toUpperCase() + raw.slice(1);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(camera);
  }
  return Array.from(groups.entries());
}

function cameraLabel(camera: CameraView) {
  return camera.name || camera.id;
}

const NAV_ICONS = [
  { key: "grid", path: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" },
  { key: "cam", path: "M23 7l-7 5 7 5zM1 5h15v14H1z" },
  { key: "map", path: "M1 6l7-3 8 3 7-3v15l-7 3-8-3-7 3zM8 3v15M16 6v15" },
  { key: "monitor", path: "M2 3h20v14H2zM8 21h8M12 17v4" },
  { key: "chart", path: "M3 3v18h18M7 16v-5M12 16V8M17 16v-9" },
  { key: "clipboard", path: "M9 2h6v3H9zM7 4H5v18h14V4h-2M9 11h6M9 15h6" },
  { key: "sync", path: "M21 2v6h-6M3 22v-6h6M3 12a9 9 0 0 1 15-6.7L21 8M21 12a9 9 0 0 1-15 6.7L3 16" },
  { key: "users", path: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
];

export default function CamerasPage() {
  const [cameras, setCameras] = useState<CameraView[]>([]);
  const [cameraLoadError, setCameraLoadError] = useState<string | null>(null);
  const [modelWarning, setModelWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [columns, setColumns] = useState<LayoutCols>(2);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState("cam");
  const [now, setNow] = useState<Date | null>(null);

  function refreshCameraStatus() {
    fetchCameraConfig()
      .then((cams) => {
        setCameras(cams);
        setCameraLoadError(null);
        setSelectedId((current) => current ?? cams[0]?.id ?? null);
        const affected = cams.find((c) => c.enabled && !c.inference_enabled);
        setModelWarning(
          affected
            ? `YOLO inference disabled: ${
                affected.model_error ?? `model not loaded from ${affected.model_path}`
              }`
            : null,
        );
      })
      .catch((err) => {
        setCameraLoadError(err instanceof Error ? err.message : "Failed to load cameras");
      });
  }

  useEffect(() => {
    refreshCameraStatus();
    const statusTimer = setInterval(refreshCameraStatus, 3000);
    return () => clearInterval(statusTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const filteredCameras = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cameras;
    return cameras.filter(
      (c) =>
        cameraLabel(c).toLowerCase().includes(q) ||
        (c.host ?? "").toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }, [cameras, search]);

  const groups = useMemo(() => groupCameras(filteredCameras), [filteredCameras]);
  const onlineCount = useMemo(() => cameras.filter((c) => c.online).length, [cameras]);

  const dateLabel = now
    ? now.toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
  const timeLabel = now
    ? now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "";

  return (
    <>
      <style>{`
        .app-shell {
          display: flex; height: 100vh; padding: 16px; gap: 0;
          background: var(--bg);
        }
        .surface {
          display: flex; flex: 1; min-width: 0; overflow: hidden;
          background: var(--panel); border: 1px solid var(--border-soft);
          border-radius: 18px;
        }
        /* icon rail */
        .rail {
          display: flex; flex-direction: column; align-items: center;
          width: 64px; padding: 16px 0; gap: 6px;
          border-right: 1px solid var(--border-soft);
        }
        .rail-logo {
          width: 34px; height: 34px; border-radius: 9px; margin-bottom: 14px;
          background: linear-gradient(135deg, #ff8a4c, #f0652c);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 14px rgba(240,101,44,0.4);
        }
        .rail-btn {
          width: 40px; height: 40px; border-radius: 10px; border: none;
          display: flex; align-items: center; justify-content: center;
          background: transparent; color: var(--faint); cursor: pointer;
          transition: all 0.15s;
        }
        .rail-btn:hover { color: var(--text); background: var(--elevated); }
        .rail-btn.active { color: var(--text); background: var(--elevated); }
        .rail-spacer { flex: 1; }
        /* sidebar */
        .sidebar {
          width: 248px; flex-shrink: 0; display: flex; flex-direction: column;
          border-right: 1px solid var(--border-soft); padding: 18px 12px;
          overflow-y: auto;
        }
        .sidebar-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 8px 14px;
        }
        .sidebar-head .title { font-size: 15px; font-weight: 600; color: var(--text); }
        .sidebar-head .chev {
          width: 24px; height: 24px; border-radius: 7px; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          background: transparent; color: var(--muted);
        }
        .group-label {
          font-size: 12px; font-weight: 600; color: var(--faint);
          padding: 14px 8px 6px;
        }
        .cam-row {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 9px 8px; border-radius: 8px; border: none; cursor: pointer;
          background: transparent; color: var(--muted); text-align: left;
          font-size: 13.5px; transition: all 0.12s;
        }
        .cam-row:hover { background: var(--elevated); color: var(--text); }
        .cam-row.active { color: var(--brand); background: var(--brand-soft); font-weight: 600; }
        .cam-row .row-dot { margin-left: auto; width: 6px; height: 6px; border-radius: 50%; }
        /* main */
        .main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
        .topbar {
          display: flex; align-items: center; gap: 16px;
          padding: 16px 22px;
        }
        .search {
          flex: 1; max-width: 520px; position: relative; display: flex; align-items: center;
        }
        .search svg { position: absolute; left: 14px; color: var(--faint); pointer-events: none; }
        .search input {
          width: 100%; height: 42px; padding: 0 14px 0 40px;
          background: var(--card); border: 1px solid var(--border);
          border-radius: 10px; color: var(--text); font-size: 13.5px; outline: none;
        }
        .search input::placeholder { color: var(--faint); }
        .search input:focus { border-color: #3a3a3a; }
        .topbar-right { margin-left: auto; display: flex; align-items: center; gap: 14px; }
        .icon-btn {
          width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--border);
          background: var(--card); color: var(--muted); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .icon-btn:hover { color: var(--text); }
        .profile { display: flex; align-items: center; gap: 9px; cursor: pointer; }
        .avatar {
          width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, #4b5563, #1f2937);
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-size: 13px; font-weight: 600;
        }
        .profile .name { font-size: 13.5px; color: var(--text); font-weight: 500; }
        .daterow {
          display: flex; align-items: center; padding: 4px 22px 16px;
        }
        .date-pill {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 14px; background: var(--card);
          border: 1px solid var(--border); border-radius: 10px;
          font-size: 13px; color: var(--text);
        }
        .date-pill .time { color: var(--muted); }
        .date-pill svg { color: var(--brand); }
        .layout-toggle {
          margin-left: auto; display: flex; gap: 4px; padding: 4px;
          background: var(--card); border: 1px solid var(--border); border-radius: 10px;
        }
        .layout-toggle button {
          width: 32px; height: 30px; border-radius: 7px; border: none; cursor: pointer;
          background: transparent; color: var(--faint);
          display: flex; align-items: center; justify-content: center;
        }
        .layout-toggle button.active { background: var(--elevated); color: var(--text); }
        .grid-scroll { flex: 1; overflow-y: auto; padding: 0 22px 22px; }
        .cam-overlay-center {
          position: absolute; inset: 0; display: flex; align-items: center;
          justify-content: center; color: var(--muted); font-size: 12px;
          letter-spacing: 0.08em; background: #0d0d0d;
        }
        .status-strip {
          display: flex; align-items: center; gap: 7px;
          font-size: 12px; color: var(--muted);
        }
        .status-strip .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--green); box-shadow: 0 0 6px var(--green);
          animation: pulse 2s infinite;
        }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>

      <div className="app-shell">
        <div className="surface">
          {/* icon rail */}
          <nav className="rail">
            <div className="rail-logo">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                <path d="M4 14a8 8 0 0 1 16 0v1H4z" opacity="0.95" />
                <circle cx="12" cy="6" r="2.4" />
              </svg>
            </div>
            {NAV_ICONS.map((icon) => (
              <button
                key={icon.key}
                className={`rail-btn ${activeNav === icon.key ? "active" : ""}`}
                onClick={() => setActiveNav(icon.key)}
                title={icon.key}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={icon.path} />
                </svg>
              </button>
            ))}
            <div className="rail-spacer" />
            <button className="rail-btn" title="Settings">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </nav>

          {/* sidebar camera list */}
          <aside className="sidebar">
            <div className="sidebar-head">
              <span className="title">Live Monitoring</span>
              <button className="chev" title="Collapse">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            </div>

            {groups.length === 0 ? (
              <div style={{ padding: "8px", color: "var(--faint)", fontSize: 13 }}>
                No cameras found
              </div>
            ) : (
              groups.map(([groupName, groupCams]) => (
                <div key={groupName}>
                  <div className="group-label">{groupName}</div>
                  {groupCams.map((camera) => {
                    const active = camera.id === selectedId;
                    const dot = camera.enabled === false
                      ? "var(--faint)"
                      : camera.online
                        ? "var(--green)"
                        : "var(--yellow)";
                    return (
                      <button
                        key={camera.id}
                        className={`cam-row ${active ? "active" : ""}`}
                        onClick={() => setSelectedId(camera.id)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 7l-7 5 7 5zM1 5h15v14H1z" />
                        </svg>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {cameraLabel(camera)}
                        </span>
                        <span className="row-dot" style={{ background: dot }} />
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </aside>

          {/* main */}
          <section className="main">
            <div className="topbar">
              <div className="search">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Camera"
                />
              </div>
              <div className="topbar-right">
                <div className="status-strip">
                  <span className="dot" />
                  {onlineCount}/{cameras.length} online
                </div>
                <button className="icon-btn" title="Notifications">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </button>
                <div className="profile">
                  <div className="avatar">A</div>
                  <span className="name">Administrator</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="daterow">
              <div className="date-pill">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
                <span>{dateLabel || "—"}</span>
                <span className="time">{timeLabel}</span>
              </div>
              <div className="layout-toggle">
                {([1, 2, 3] as LayoutCols[]).map((c) => (
                  <button
                    key={c}
                    className={columns === c ? "active" : ""}
                    onClick={() => setColumns(c)}
                    title={`${c} column${c > 1 ? "s" : ""}`}
                  >
                    {c === 1 ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="5" width="16" height="14" rx="1.5" /></svg>
                    ) : c === 2 ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="8" height="14" rx="1.5" /><rect x="13" y="5" width="8" height="14" rx="1.5" /></svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="8" height="7" rx="1.2" /><rect x="13" y="4" width="8" height="7" rx="1.2" /><rect x="3" y="13" width="8" height="7" rx="1.2" /><rect x="13" y="13" width="8" height="7" rx="1.2" /></svg>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {modelWarning && (
              <div
                style={{
                  margin: "0 22px 14px",
                  padding: "10px 12px",
                  border: "1px solid rgba(234, 179, 8, 0.45)",
                  borderRadius: 8,
                  background: "rgba(234, 179, 8, 0.1)",
                  color: "var(--yellow)",
                  fontSize: 12,
                }}
              >
                {modelWarning}
              </div>
            )}

            <div className="grid-scroll">
              {cameraLoadError ? (
                <div
                  style={{
                    display: "flex",
                    aspectRatio: "16 / 9",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--red)",
                    fontSize: 13,
                  }}
                >
                  {cameraLoadError}
                </div>
              ) : (
                <CameraGrid
                  cameras={filteredCameras}
                  columns={columns}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}
              <div style={{ paddingTop: 16 }}>
                <Link href="/" style={{ color: "var(--faint)", fontSize: 12 }}>
                  &larr; Back to demo
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
