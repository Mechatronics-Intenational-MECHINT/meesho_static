# MECHINT STATIC PROFILER — v2.0 Beta

Release candidate: **2.0.0-beta.1**. Customer installation: Meesho. Development branch: `develop/v2.0-beta`.

## Release safety
**NOT A PRODUCTION RELEASE.** Nothing is deployed to the Meesho IPC. Branch `main` remains untouched. Node-RED, PLC settings, MongoDB schemas, and Meesho API contracts remain as-is.

## Implemented in first development increment
- Dynamic frontend service endpoint configuration from `REACT_APP_API_BASE_URL`, falling back to the browser's current hostname at port 5001. Use HTTP/WS together, HTTPS/WSS together.
- WebSocket reconnect with bounded exponential delay.
- Correct missing-image placeholder and reset of image on the next parcel.
- Error fallback when an image URL fails to load.
- Backend selection of the latest barcode-prefixed JPG/PNG/BMP file by file modification time, preserving extension and checking file-size/mtime stability before copy.

## Planned work (not yet implemented)
### P0 Reliability
- Correlate each camera image with a unique scan identifier (including repeated barcodes).
- Atomic camera file publication after image capture/crop; coordinate changes with latest Node-RED flow and PLC trigger.
- Durable post-restart parcel feed synchronization; explicit operational WebSocket health.
- Structured error and audit events for scanner, DWS, camera, backend and API failures.
- API retry/integration tests for inscan, log sync and image upload; idempotency policy.

### P1 Operator experience
- Branded MECHINT STATIC PROFILER dashboard and responsive layout.
- Parcel journey screen with stage timestamps and actionable failure reasons.
- System diagnostics and alerts with severity, state and recovery hints.
- Throughput, scan/camera success, rejection and downtime reporting.

### P2 Productization
- Customer/site/machine configuration, version and deployment tracking.
- Roles, audit trails, test harness, diagnostics export and release automation.

## Preconditions for site tests
1. Backup current deployed Node-RED flows, backend, frontend build and database.
2. Set `REACT_APP_API_BASE_URL` during React build when backend is hosted elsewhere, e.g. `http://192.168.85.3:5001`.
3. Verify dashboard on IPC and another workstation; confirm HTTP image GET and WS reconnect.
4. Capture 50+ parcels with normal camera timing, delayed images, invalid/missing images and repeated barcodes.
5. Verify Node-RED to PLC handshakes and Meesho API flows are unchanged.
6. Review exposed camera passwords in prior Node-RED export: rotate device password and move secrets out of committed flow source.
7. Run frontend build, backend syntax/tests, end-to-end staging run, and controls-engineer release approval before merging.

## Known limitations
- Latest-by-modification-time may select a prior image for a repeated barcode; scan-ID correlation is required.
- Image file stability over 200 ms cannot guarantee capture/crop completion. Publish final files atomically in a later change.
- Existing API calls in other frontend pages and server-side CORS policy require a separate configuration audit.
- The current frontend supports reconnect, **not** missed-event replay.
- No machine-level verification or full build has been performed yet.
