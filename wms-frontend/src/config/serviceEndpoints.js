// MECHINT STATIC PROFILER v2.0 Beta - shared frontend service endpoints.
// Set REACT_APP_API_BASE_URL at build time for remote installations.
// Example: REACT_APP_API_BASE_URL=http://192.168.85.3:5001
const configured = (process.env.REACT_APP_API_BASE_URL || "").trim().replace(/\/$/, "");
export const API_BASE_URL = configured ||
  `${window.location.protocol}//${window.location.hostname || "localhost"}:5001`;
export function websocketUrl(endpoint) {
  return API_BASE_URL.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + endpoint;
}
export const BIN_DATA_WS_URL = websocketUrl("/bin-data");

// Node-RED may run on a different host/port from the API server.
export const NODE_RED_BASE_URL = (process.env.REACT_APP_NODE_RED_BASE_URL || "").trim().replace(/\/$/, "") ||
  `${window.location.protocol}//${window.location.hostname || "localhost"}:1880`;

export function imageUrl(imagePath) {
  if (typeof imagePath !== "string" || !imagePath.startsWith("/uploads/")) {
    return null;
  }
  return `${API_BASE_URL}${imagePath}`;
}
