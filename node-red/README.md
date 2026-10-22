# Meesho Static Node-RED snapshot (2026-10-13)

Source: User-provided Node-RED export `flows (36).json`, 364 nodes.
Version control branch: `fix/camera-image-reliability-v1`.

This snapshot is **reference-only**, not a validated production deployment. Existing root `flows.json` has not been replaced.

## Credential safety
This public repository MUST NOT contain device passwords. Two Function nodes (`Format Curl Command` and `OldmCurl Command`) had their inline camera passwords replaced with `REPLACE_WITH_SECURE_CAMERA_PASSWORD` before commit. This placeholder will not authenticate to the camera; never deploy the snapshot unmodified. Use a protected credential mechanism for the real password and rotate the exposed camera credential.

## Image-capture findings
- Active `Format Curl Command` constructs a filename from `ScannedBarcode`, downloads a JPG via curl, then crops it in place with ImageMagick.
- The backend in this branch reads a barcode-prefixed image filename; ensure the barcode used in the filename exactly matches the barcode sent to the backend.
- Image writing is not atomic: a backend reader can see the original camera download before cropping is finished. Future release should write/crop temporary files then atomically publish the final JPG.
- The screenshot timestamp uses a fixed IST offset combined with local getters. Verify and fix to avoid double timezone conversion on an IST-configured Windows IPC.
- The Node-RED `Curl Command` Exec node uses spawn mode. Test shell chaining (`&&`) in the actual Windows environment before changing commands.
- `Get latest BMP path new` includes `require("fs")`, which fails in a standard Function node if the global `fs` was not registered.
- Separate `Read image as buffer` and base64 conversion paths exist. The backend UI uses `imagePath` URLs rather than this base64 payload.

## Site deployment checklist
1. Back up existing flows and the Node-RED runtime settings.
2. Compare live flows against this snapshot; do not import wholesale without diffing active PLC tags, serial ports, and endpoints.
3. Replace credential placeholders via approved secret handling, never in GitHub.
4. Validate image capture, image rename/crop, backend match, `/uploads` HTTP response and frontend display.
5. Confirm previous-parcel images are not displayed and reconnection recovers after backend restart.

Release status: **review pending; not deployed**.
