import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGlobe,
  faBell,
  faPowerOff,
  faUserCircle,
  faWeightHanging
} from "@fortawesome/free-solid-svg-icons";
import "../styles/Navbar.css";
import logo from "../assets/mechint_logo.jpeg";

const STATUS_API = "http://localhost:5001/api/status/status-latest";
const WEIGHT_WS_URL = "ws://localhost:5001/live-weight";
const IGNORED_STATUS_KEYS = new Set(["_id", "__v", "timestamp"]);

const Navbar = () => {
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [username, setUsername] = useState("");
  const [isInternetOnline, setIsInternetOnline] = useState(navigator.onLine);
  const [showNotifications, setShowNotifications] = useState(false);

  // null = not yet checked, true = healthy, false = alarm active
  const [isHealthy, setIsHealthy] = useState(null);
  const [liveWeight, setLiveWeight] = useState(null);

  const weightWsRef = useRef(null);
  const weightReconnectTimer = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    const checkInternet = async () => {
      if (!navigator.onLine) {
        setIsInternetOnline(false);
        return;
      }
      try {
        await fetch("https://clients3.google.com/generate_204", {
          method: "GET",
          mode: "no-cors",
        });
        setIsInternetOnline(true);
      } catch {
        setIsInternetOnline(false);
      }
    };

    checkInternet();
    const net = setInterval(checkInternet, 5000);

    const user = localStorage.getItem("username");
    if (user) {
      setUsername(user.charAt(0).toUpperCase() + user.slice(1));
    }

    return () => {
      clearInterval(timer);
      clearInterval(net);
    };
  }, []);

  // ── Health status polling (every 4s) ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const fetchHealth = async () => {
      try {
        const res = await fetch(STATUS_API);
        const data = await res.json();

        const hasActiveAlarm = Object.entries(data).some(([key, val]) => {
          if (IGNORED_STATUS_KEYS.has(key)) return false;
          return Number(val) === 1;
        });

        if (!cancelled) setIsHealthy(!hasActiveAlarm);
      } catch (err) {
        if (!cancelled) setIsHealthy(null);
      }
    };

    fetchHealth();
    const healthTimer = setInterval(fetchHealth, 4000);

    return () => {
      cancelled = true;
      clearInterval(healthTimer);
    };
  }, []);

  // ── Live weight WebSocket ────────────────────────────────────────────────
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WEIGHT_WS_URL);
      weightWsRef.current = ws;

      ws.onmessage = (event) => {
        let raw = event.data;
        try {
          const parsed = JSON.parse(raw);
          raw = typeof parsed === "object" ? parsed.weight : parsed;
        } catch {
          // not JSON — use as-is
        }
        const num = parseFloat(raw);
        if (!Number.isNaN(num)) setLiveWeight(num);
      };

      ws.onclose = () => {
        weightReconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(weightReconnectTimer.current);
      if (weightWsRef.current) {
        weightWsRef.current.onclose = null;
        weightWsRef.current.close();
      }
    };
  }, []);

  const handleLogout = async () => {
    try {
      await axios.post("http://localhost:1880/login-code", { code: true });
    } catch (e) {}

    localStorage.removeItem("token");
    localStorage.removeItem("username");
    navigate("/login");
  };

  const healthDotClass =
    isHealthy === null ? "dot-unknown" : isHealthy ? "dot-ok" : "dot-alert";

  return (
    <nav className="custom-navbar">
      <div className="navbar-left">
        <img src={logo} alt="logo" className="navbar-logo" />

        <div className="navbar-brand">
          <div className="navbar-title">
            MECHATRONICS INTERNATIONAL
          </div>

          <div className="navbar-subtitle">
            Smart Automation and Robotics
          </div>
        </div>
      </div>

      <div className="navbar-right">
        <div className="nav-weight" title="Live weight reading from the conveyor scanner">
          <FontAwesomeIcon icon={faWeightHanging} className="weight-icon" />
          <div className="weight-info">
            <span className="weight-label">LIVE WEIGHT</span>
            <span className="weight-value">
              {liveWeight === null ? "-- g" : `${liveWeight} g`}
            </span>
          </div>
        </div>

        <div className="nav-health" title="System health — red means an active alarm">
          <span className={`health-dot ${healthDotClass}`} />
          <div className="health-info">
            <span className="health-label">SYSTEM</span>
            <span className="health-value">Healthy</span>
          </div>
        </div>

        <div className="nav-status">
          <FontAwesomeIcon
            icon={faGlobe}
            className={isInternetOnline ? "status-online" : "status-offline"}
          />
          <span>{isInternetOnline ? "Online" : "Offline"}</span>
        </div>

        <div className="nav-time">
          {currentTime
            .toLocaleString("en-GB", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })
            .replace(/\//g, "-")}
        </div>

        <div className="nav-user">
          <FontAwesomeIcon icon={faUserCircle} className="user-icon" />
          <div className="user-info">
            <span className="user-label">WELCOME</span>
            <span className="user-name">{username || "Admin"}</span>
          </div>
        </div>

        <div className="notification-wrapper">
          <button
            className="notification-btn"
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <FontAwesomeIcon icon={faBell} />
            <span className="notification-badge">0</span>
          </button>

          {showNotifications && (
            <div className="notification-dropdown">
              <div className="notification-title">Notifications</div>
              <div className="notification-empty">
                No notifications yet.
              </div>
            </div>
          )}
        </div>

        <button className="logout-btn" onClick={handleLogout}>
          <FontAwesomeIcon icon={faPowerOff} />
          <span>Logout</span>
        </button>
      </div>
    </nav>
  );
};

export default Navbar;