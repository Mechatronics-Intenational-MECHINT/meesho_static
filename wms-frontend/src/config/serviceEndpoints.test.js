import { API_BASE_URL, BIN_DATA_WS_URL, NODE_RED_BASE_URL, imageUrl, websocketUrl } from "./serviceEndpoints";

test("service endpoints use the same backend and correct WebSocket protocol", () => {
  expect(API_BASE_URL).toMatch(/^https?:\/\//);
  expect(BIN_DATA_WS_URL).toBe(websocketUrl("/bin-data"));
  expect(BIN_DATA_WS_URL).toMatch(/^wss?:\/\//);
  expect(NODE_RED_BASE_URL).toMatch(/^https?:\/\//);
});

test("imageUrl rejects missing-image markers and unsafe/unexpected paths", () => {
  for (const value of [null, "", "image_missing", "https://example.org/a.jpg", "//external.com/img", "/api/health"]) {
    expect(imageUrl(value)).toBeNull();
  }
  expect(imageUrl("/uploads/parcel.jpg")).toBe(API_BASE_URL + "/uploads/parcel.jpg");
});
