# Camera Image Reliability - v1.0.0 (proposed)

Branch: `fix/camera-image-reliability-v1`
Base: `main`
Status: **staged for site testing; not merged or deployed**

## Changes
- Frontend (`wms-frontend/src/pages/Home.js`): reconnect `/bin-data` WebSocket after unexpected disconnect; use the browser's current hostname for image and WebSocket access.
- Ignore `image_missing` or malformed image paths instead of constructing invalid image URLs.
- Clear the previous parcel's image when a new barcode arrives with no image path.
- Display the fallback placeholder and log a browser-console error if an image fails to load.
- Backend (`backend/server.js`): consider only image files, pick the matching filename with the newest modification time (not alphabetical order), and check file size and modification time remain unchanged for 200 ms before copying it.
- Preserve the original supported image extension and sanitize output filenames.
- Keep existing image reconciliation (every 5 seconds) for late captures.

## Site acceptance tests (must pass before merge)
1. With the camera running, scan 20+ parcels. Confirm each displayed image belongs to its barcode and the browser network request for `/uploads/...` succeeds (HTTP 200).
2. Introduce a 1-3 second camera save delay: initially show *No image for this parcel*, then confirm the same current parcel receives `image-update` and image appears.
3. Stop and restart backend while dashboard remains open. Confirm WebSocket reconnects within roughly 10 seconds and subsequent scans appear.
4. Scan a parcel with no image: previous parcel's image must **never** remain visible.
5. Open dashboard from another PC using the IPC hostname/IP, confirm the WebSocket and image paths load (check network/firewall and mixed-content settings).
6. Test JPG/JPEG/PNG/BMP files with barcode-prefix filenames, including partially written files.
7. Confirm Node-RED image capture and existing scan processing remain unaffected.
8. Test duplicate scans / same barcode in quick succession; verify image pairing remains correct. This is a known limitation of barcode-prefix filename matching.

## Known limitations / follow-up
- The backend still expects `D:\\Images` and filenames starting with the parcel barcode; camera naming must agree.
- This release does **not** modify Node-RED flows or introduce scan-ID correlation. A repeated barcode can still match an older file. True exactly-once parcel matching requires camera capture ID / scan ID in both systems.
- The frontend reconnects to new events, but does not replay events missed while offline. A backend latest-parcel snapshot endpoint would close that gap.
- A stable file-size check does not prove a camera file has been fully finalized in every possible camera implementation; an atomic rename or file-ready event would be stronger.
- Update is source-only: build, unit tests and live IPC integration tests have not been run.

## Deployment
1. Back up production flows, frontend build, backend code, and relevant database records.
2. Test this branch on a staging IPC using realistic camera timing.
3. Rebuild React frontend and deploy rebuilt assets along with backend change.
4. Restart backend and verify Node-RED/PLC connectivity.
5. Roll back to the previous production commit if acceptance checks fail.

## Version control
- Do not deploy changes directly from this unreviewed branch.
- Merge via pull request after site testing and team approval.
- Tag the tested release as `camera-image-v1.0.0` once approved.
