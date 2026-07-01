import net from "net";
import { DEFAULT_CREDENTIALS, RTSP_PATH_CANDIDATES } from "../config";

const PROBE_TIMEOUT_MS = 1500;

/**
 * DESCRIBE result, classified by RTSP status so we can find the correct PATH
 * even when we don't yet know the camera's password:
 *   - "open"     200 OK             — path valid AND reachable with these creds
 *   - "auth"     401/403            — path VALID, just needs credentials
 *   - "notfound" 404                — wrong path
 *   - "unreachable" timeout/other   — no useful answer
 * A 401 is the key signal: the server recognised the resource and only wants
 * auth, so the path is right and the runtime password-fallback can fill in the
 * real credentials later.
 */
type ProbeStatus = "open" | "auth" | "notfound" | "unreachable";

function buildRtspUrl(
  host: string,
  port: number,
  path: string,
  username?: string,
  password?: string,
): string {
  const auth =
    username !== undefined
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password ?? "")}@`
      : "";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `rtsp://${auth}${host}:${port}${normalizedPath}`;
}

function classifyStatusLine(statusLine: string): ProbeStatus {
  if (statusLine.includes(" 200")) return "open";
  if (statusLine.includes(" 401") || statusLine.includes(" 403")) return "auth";
  if (statusLine.includes(" 404")) return "notfound";
  return "unreachable";
}

async function describeRoute(
  host: string,
  port: number,
  path: string,
  username?: string,
  password?: string,
): Promise<ProbeStatus> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: ProbeStatus) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => {
      const auth =
        username !== undefined ? `${username}:${password ?? ""}@` : "";
      const request = [
        `DESCRIBE rtsp://${auth}${host}:${port}${path} RTSP/1.0`,
        "CSeq: 1",
        "User-Agent: Aegis/1.0",
        "Accept: application/sdp",
        "",
        "",
      ].join("\r\n");
      socket.write(request);
    });
    socket.once("data", (chunk) => {
      const statusLine = chunk.toString("utf8").split("\r\n", 1)[0] ?? "";
      finish(classifyStatusLine(statusLine));
    });
    socket.once("timeout", () => finish("unreachable"));
    socket.once("error", () => finish("unreachable"));
    socket.connect(port, host);
  });
}

/**
 * Find the best RTSP URL for a host:port. Prefers a path that is openly
 * reachable (200), else the first path that merely needs auth (401/403) so
 * the correct path is captured regardless of the camera's password.
 */
export async function probeRtspUrl(host: string, port: number): Promise<string> {
  let validPath: string | null = null;

  for (const path of RTSP_PATH_CANDIDATES) {
    // One credential-less DESCRIBE is enough to tell a valid path (401) from a
    // wrong one (404) — path validity does not depend on the password.
    const status = await describeRoute(host, port, path);

    if (status === "open") {
      return buildRtspUrl(host, port, path);
    }

    if (status === "auth" && !validPath) {
      validPath = path;
      // A valid but protected path — try the known default creds so we can hand
      // back a ready-to-stream 200 URL when the camera uses common defaults.
      for (const cred of DEFAULT_CREDENTIALS) {
        if ((await describeRoute(host, port, path, cred.username, cred.password)) === "open") {
          return buildRtspUrl(host, port, path, cred.username, cred.password);
        }
      }
    }
  }

  if (validPath) {
    // Correct path, but none of the default creds worked. Embed a placeholder
    // admin credential; the runtime password-fallback swaps in the real one.
    const cred = DEFAULT_CREDENTIALS[0];
    return buildRtspUrl(host, port, validPath, cred.username, cred.password);
  }

  return buildRtspUrl(host, port, RTSP_PATH_CANDIDATES[0]);
}
