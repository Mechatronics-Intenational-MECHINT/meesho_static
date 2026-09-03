import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import alarmDictionary from "../utils/alarmDictionary";
import "../styles/MachineStatusPage.css";

const MachineStatusPage = () => {
  const [alarmStatus, setAlarmStatus] = useState({});
  const [loading,     setLoading]     = useState(true);

  /* ── fetch every 1s ── */
  useEffect(() => {
    const fetchAlarms = () => {
      axios
        .get("http://localhost:5001/api/status/status-latest")
        .then((res) => { setAlarmStatus(res.data); setLoading(false); })
        .catch((err) => console.error("❌ Alarm fetch error:", err.message));
    };
    fetchAlarms();
    const interval = setInterval(fetchAlarms, 1000);
    return () => clearInterval(interval);
  }, []);

  /* ── sorted entries ── */
  const entries = useMemo(
    () => Object.entries(alarmDictionary).sort((a, b) => Number(a[0]) - Number(b[0])),
    []
  );

  /* ── stats ── */
  const activeCount = useMemo(
    () => entries.filter(([code]) => alarmStatus[code] === 1).length,
    [entries, alarmStatus]
  );
  const normalCount = entries.length - activeCount;

  /* ════════════════════════════════════════ RENDER ════════════════════════════════════════ */
  return (
    <div className="ms-page">

      {/* ── Header ── */}
      <div className="ms-header">
        <div className="ms-title">
          <span className="ms-title-dot"/>
          Machine Alarm Status
        </div>

        <div className="ms-stats">
          <div className="ms-stat-pill total">
            <span className="ms-stat-dot total"/>
            Total: {entries.length}
          </div>
          <div className="ms-stat-pill active">
            <span className="ms-stat-dot active"/>
            Active: {activeCount}
          </div>
          <div className="ms-stat-pill normal">
            <span className="ms-stat-dot normal"/>
            Normal: {normalCount}
          </div>
        </div>
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <div className="ms-loading">
          <div className="ms-spinner"/>
          Fetching alarm status…
        </div>
      ) : (
        <div className="ms-scroll">
          <div className="ms-grid">
            {entries.map(([code, { message }]) => {
              const isActive = alarmStatus[code] === 1;
              return (
                <div
                  key={code}
                  className={`ms-card ${isActive ? "alarm" : "normal"}`}
                >
                  <div className="ms-code">{code}</div>
                  <div className="ms-message">{message}</div>
                  <div className="ms-status-indicator">
                    <span className="ms-status-led"/>
                    {isActive ? "ACTIVE" : "OK"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};

export default MachineStatusPage;