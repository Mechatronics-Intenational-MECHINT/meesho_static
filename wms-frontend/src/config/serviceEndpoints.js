// MECHINT STATIC PROFILER v2.0 Beta - shared frontend service endpoints.
// Set REACT_APP_API_BASE_URL at build time for remote installations.
// Example: REACT_APP_API_BASE_URL=http://192.168.85.3:5001
const configured = (process.env.REACT_APP_API_BASE_URL || "").trim().replace(/\/$/, "");
export const API_BASE_URL = configured ||
  `${window.location.protocol}//${window.location.hostname || "localhost"}:5001`;
export const BIN_DATA_WS_URL =
  API_BASE_URL.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + "/bin-data";

export function imageUrl(imagePath) {
  if (typeof imagePath !== "string" || !imagePath.startsWith("/uploads/")) {
    return null;
  }
  return `${API_BASE_URL}${imagePath}`;
}
