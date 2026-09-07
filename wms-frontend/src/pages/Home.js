import React, { useState, useEffect, useMemo, useRef } from "react";
import "../styles/Home.css";
import box from "../icons/box.png";
import date from "../icons/date.png";
import time from "../icons/time.png";
import axios from "axios";
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';
import "bootstrap/dist/css/bootstrap.min.css";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";

const LIVE_THRESHOLD_MS = 8000;

// ── Status meta: label + CSS modifier, shared by banner and table badge ──────
function getStatusMeta(status) {
  const s = (status || "").toLowerCase();
  if (s === "pass") return { label: "PASS", cls: "status-pass" };
  if (s === "rejected") return { label: "REJECTED", cls: "status-rejected" };
  if (s === "duplicate") return { label: "DUPLICATE", cls: "status-duplicate" };
  return { label: "—", cls: "status-idle" };
}

const Home = () => {
  const [boxDetails, setBoxDetails] = useState({
    barcode: "",
    length: "",
    breadth: "",
    height: "",
    weight: "",
    volumetricWeight: "",
    RealVolume: "",
    Volume: "",
    date: "",
    time: "",
    status: "",
  });

  const [stats, setStats] = useState({
    inScanPercent: 0,
    dwsPercent: 0,
    largeBoxPercent: 0,
    lightBoxPercent: 0,
    todayProcessedPercent: 0,
  });
  const [bins, setBins] = useState([]);
  const [weeklyData, setWeeklyData] = useState([]);
  const [settings, setSettings] = useState(null);
  const [hourlyData, setHourlyData] = useState([]);

  const [lastMsgAt, setLastMsgAt] = useState(null);
  const [isLive, setIsLive] = useState(false);
  const [flash, setFlash] = useState(false);
  const flashTimerRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:5001/bin-data");

    ws.onopen = () => console.log("📦 Connected to /bin-data WS");

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);

        if (data.type === "image-update") {
          setBoxDetails((prev) =>
            prev.barcode === data.barcode ? { ...prev, imagePath: data.imagePath } : prev
          );
          setBins((prev) =>
            prev.map((b) => (b.barcode === data.barcode ? { ...b, imagePath: data.imagePath } : b))
          );
          return;
        }

        setBoxDetails((prev) => ({
          barcode:    data.barcode    ?? prev.barcode,
          length:     data.length     ?? prev.length,
          breadth:    data.breadth    ?? prev.breadth,
          height:     data.height     ?? prev.height,
          weight:     data.weight     ?? prev.weight,
          volumetricWeight: data.volumetricWeight ?? prev.volumetricWeight,
          RealVolume: data.RealVolume ?? prev.RealVolume,
          Volume:     data.Volume     ?? prev.Volume,
          date:       data.date       ?? prev.date,
          time:       data.time       ?? prev.time,
          imagePath:  data.imagePath  ?? prev.imagePath,
          status:     data.status     ?? prev.status,
        }));

        setBins((prev) => [data, ...prev].slice(0, 1000));

        setLastMsgAt(Date.now());
        setFlash(true);
        clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setFlash(false), 550);
      } catch (err) {
        console.error("Error parsing bin-data WS message", err);
      }
    };

    ws.onclose = () => {
      console.log("❌ Bin data WebSocket disconnected");
    };

    return () => {
      ws.close();
      clearTimeout(flashTimerRef.current);
      console.log("🧹 Closed WebSocket for bin-data");
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      setIsLive(lastMsgAt !== null && Date.now() - lastMsgAt < LIVE_THRESHOLD_MS);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastMsgAt]);

  const imageRef = useRef(null);

  const fetchHourlyData = async () => {
    try {
      const res = await axios.get("http://localhost:5001/api/boxdata/boxdata");
      const data = res.data.data || [];

      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const hourMap = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));

      data.forEach((item) => {
        if (!item.time) return;
        const timeObj = new Date(item.time);
        const itemDate = timeObj.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        if (itemDate === today) {
          const hour = timeObj.getHours();
          if (hour >= 0 && hour < 24) {
            hourMap[hour].count += 1;
          }
        }
      });

      setHourlyData(hourMap);
    } catch (err) {
      console.error("Error fetching hourly shipment data:", err.message);
    }
  };

  useEffect(() => {
    fetchHourlyData();
    const interval = setInterval(fetchHourlyData, 600000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await axios.get("http://localhost:5001/api/settings/settings-data");
        setSettings(res.data);
      } catch (err) {
        console.error("Failed to fetch settings", err);
      }
    };
    fetchSettings();
  }, []);

  const fetchWeeklyData = async () => {
    try {
      const IST_MS = 5.5 * 3600 * 1000;

      const nowUTC = new Date();
      const nowIST = new Date(nowUTC.getTime() + IST_MS);

      const pad = (n) => String(n).padStart(2, "0");
      const fmtIST = (d) =>
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

      const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const last7 = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(nowIST);
        d.setUTCDate(d.getUTCDate() - i);
        const dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
        const label = DAY_NAMES[d.getUTCDay()];
        last7.push({ dateStr, label, count: 0 });
      }

      const startIST = `${last7[0].dateStr} 00:00:00`;
      const endIST = `${last7[6].dateStr} 23:59:59`;

      const res = await axios.get("http://localhost:5001/api/boxdata/boxdata", {
        params: { startDateTime: startIST, endDateTime: endIST, limit: 10000 },
      });
      const data = res.data.data || [];

      data.forEach((item) => {
        const raw = item.date || item.createdAt || "";
        if (!raw) return;
        const dateOnly = raw.substring(0, 10);
        const slot = last7.find((s) => s.dateStr === dateOnly);
        if (slot) slot.count++;
      });

      const formatted = last7.map((s) => ({ day: s.label, boxes: s.count }));
      setWeeklyData(formatted);
    } catch (err) {
      console.error("Error fetching weekly production data:", err.message);
    }
  };

  useEffect(() => {
    fetchWeeklyData();
    const interval = setInterval(() => {
      fetchWeeklyData();
    }, 3600000);
    return () => clearInterval(interval);
  }, []);

  const hasReading = Boolean(boxDetails.barcode);
  const currentStatus = getStatusMeta(boxDetails.status);

  return (
    <div className="home-wrapper">

      {/* ── Status strip ── */}
      <div className={`console-statusbar${flash ? " flash" : ""}`}>
        <div className={`live-pulse ${isLive ? "on" : "idle"}`}>
          <span className="pulse-dot" />
          {isLive ? "LIVE READING" : "IDLE"}
        </div>
        <div className="statusbar-awb">
          <span className="statusbar-awb-label">AWB</span>
          <span className="statusbar-awb-value">{boxDetails.barcode || "— awaiting scan —"}</span>
        </div>
        <div className="statusbar-time">
          <img src={date} alt="" className="statusbar-time-icon" />
          <span>{boxDetails.date || "—"}</span>
          <img src={time} alt="" className="statusbar-time-icon" />
          <span>{boxDetails.time || "—"}</span>
        </div>
      </div>

      <div className="home-container">
        {/* ── Readout panel (left) ── */}
        <div className={`readout-panel${flash ? " flash" : ""}`}>
          <div className="rt-grid-primary">
            <div className="rt-tile">
              <span className="rt-label">Length</span>
              <div className="rt-value-row">
                <span className="rt-value">{boxDetails.length || "--"}</span>
                <span className="rt-unit">mm</span>
              </div>
            </div>
            <div className="rt-tile">
              <span className="rt-label">Breadth</span>
              <div className="rt-value-row">
                <span className="rt-value">{boxDetails.breadth || "--"}</span>
                <span className="rt-unit">mm</span>
              </div>
            </div>
            <div className="rt-tile">
              <span className="rt-label">Height</span>
              <div className="rt-value-row">
                <span className="rt-value">{boxDetails.height || "--"}</span>
                <span className="rt-unit">mm</span>
              </div>
            </div>
            <div className="rt-tile">
              <span className="rt-label">Weight</span>
              <div className="rt-value-row">
                <span className="rt-value">{boxDetails.weight || "--"}</span>
                <span className="rt-unit">gm</span>
              </div>
            </div>
          </div>

          <div className="rt-grid-secondary">
            <div className="rt-tile rt-tile-secondary">
              <span className="rt-label">Real Volume</span>
              <div className="rt-value-row">
                <span className="rt-value">{boxDetails.RealVolume || "--"}</span>
                <span className="rt-unit">mm³</span>
              </div>
            </div>
            <div className="rt-tile rt-tile-secondary">
              <span className="rt-label">Volume</span>
              <div className="rt-value-row">
                <span className="rt-value">{boxDetails.Volume || "--"}</span>
                <span className="rt-unit">mm³</span>
              </div>
            </div>
            <div className="rt-tile rt-tile-secondary">
              <span className="rt-label">Volumetric Weight</span>
              <div className="rt-value-row">
                <span className="rt-value">{boxDetails.volumetricWeight || "--"}</span>
                <span className="rt-unit">mm³</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Camera panel (right) ── */}
        <div className="camera-panel">
          <div className="camera-panel-head">
            <span className={`camera-live-dot${isLive ? " on" : ""}`} />
            LIVE CAMERA
          </div>
          <div className="camera-frame" ref={imageRef}>
            {boxDetails.imagePath ? (
              <img
                src={`http://localhost:5001${boxDetails.imagePath}`}
                alt="Live Box"
                className="camera-img"
              />
            ) : (
              <div className="camera-placeholder">
                <img src={box} alt="" className="camera-placeholder-icon" />
                <p>{hasReading ? "No image for this parcel" : "Awaiting next parcel…"}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Scan result banner (full width, above table) ── */}
      <div className={`scan-result-banner ${currentStatus.cls}`}>
        <span className="scan-result-label">{currentStatus.label}</span>
        {boxDetails.barcode && (
          <span className="scan-result-barcode">{boxDetails.barcode}</span>
        )}
      </div>

      {/* ── Live Feed Table ── */}
      <div className="card live-bins-card">
        <div className="live-bins-title">
          <span className={`camera-live-dot${isLive ? " on" : ""}`} />
          Live Parcel Feed
        </div>
        <DataTable
          value={bins}
          scrollable
          scrollHeight="400px"
          stripedRows
          showGridlines
          emptyMessage="No bins available"
          className="live-bins-table"
        >
          <Column
            header="S.No"
            body={(rowData, options) => options.rowIndex + 1}
            style={{ width: "80px", textAlign: "center" }}
          />
          <Column field="barcode"      header="Barcode"     style={{ minWidth: "180px" }} />
          <Column
            header="Status"
            body={(row) => {
              const meta = getStatusMeta(row.status);
              return <span className={`row-status-badge ${meta.cls}`}>{meta.label}</span>;
            }}
            style={{ width: "110px", textAlign: "center" }}
          />
          <Column field="length"       header="Length"      style={{ textAlign: "center" }} />
          <Column field="breadth"      header="Breadth"     style={{ textAlign: "center" }} />
          <Column field="height"       header="Height"      style={{ textAlign: "center" }} />
          <Column field="weight"       header="Weight"      style={{ textAlign: "center" }} />
          <Column field="volumetricWeight"       header="Volumetric Weight"      style={{ textAlign: "center" }} />
          <Column field="angle"        header="Angle"       style={{ textAlign: "center" }} />
          <Column field="RealVolume"   header="Real Volume" style={{ textAlign: "center" }} />
          <Column field="Volume"       header="Volume"      style={{ textAlign: "center" }} />
          <Column field="InScan_Status" header="InScan"     style={{ textAlign: "center" }} />
          <Column field="DWS_Status"   header="DWS"         style={{ textAlign: "center" }} />
          <Column field="date"         header="Date"        style={{ minWidth: "120px" }} />
          <Column field="time"         header="Time"        style={{ minWidth: "120px" }} />
        </DataTable>
      </div>
    </div>
  );
};

export default Home;