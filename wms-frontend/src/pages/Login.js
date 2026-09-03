import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import loadingAnimation from "../assets/loader.json"; // <-- your Lottie file path
import axios from "axios";
import Lottie from "lottie-react";
import { sendSettingsToNodeRed } from "../utils/sendSettings";
import { Link } from "react-router-dom";
import "../styles/Login.css";
import { toast } from "react-toastify";
import Spinner from "react-bootstrap/Spinner";
import {
  TextField,
  Button,
  InputAdornment,
  IconButton,
  Checkbox,
  FormControlLabel,
} from "@mui/material";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUser,
  faLock,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import logo from "../assets/mechint_logo.jpeg";
import parcelArrives from "../assets/parcel_arrives.png";
import barcodeScanning from "../assets/barcode_scanning.png";
import parcelRouted from "../assets/parcel_routed.png";
import sortingLogic from "../assets/sorting_logic_applied.png";
import readyForDispatch from "../assets/ready_for_dispatch.png";


const slides = [
  {
    img: parcelArrives,
    title: "Parcel Arrives 📦",
  },
  {
    img: barcodeScanning,
    title: "Parcel Scanning 🔍",
  },
  {
    img: parcelRouted,
    title: "Parcel Routed Decide 🛣️",
  },
  {
    img: sortingLogic,
    title: "AI Sorting System ⚙️",
  },
  {
    img: readyForDispatch,
    title: "Dispatch & Delivery 🚚",
  },
];

function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(20);
  const navigate = useNavigate();

  const [settings, setSettings] = useState({});

  const API_URL = "http://localhost:5001";

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post("http://localhost:5001/api/users/login", {
        username,
        password,
      });
      // store login data
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("username", res.data.username);
      localStorage.setItem("role", res.data.role);
      localStorage.setItem("showCalibrationAlert", "true");
toast.success("Welcome to Our DWS System", {
  position: "top-center",
  autoClose: 3000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,

  style: {
    background: "linear-gradient(90deg, #D71920, #D71920)",
    color: "#fff",
    borderRadius: "14px",
    fontWeight: "700",
    padding: "14px 18px",
    boxShadow: "0 10px 25px rgba(255,122,0,0.35)",
  },
});

setTimeout(()=>{
      setIsLoading(true);
},3000)
      // Show Lottie loader
      let timer = 20;
      const interval = setInterval(() => {
        timer -= 1;
        setCountdown(timer);
      }, 1000);

      // After 20 seconds redirect
      setTimeout(() => {
        clearInterval(interval);
        navigate("/dashboard");
      }, 10000);

      // Notify Node-RED
      await axios
        .post("http://192.168.157.201:1880/login-code", { code: false })
        .then(() => console.log("✅ Login code sent to Node-RED"))
        .catch((err) => console.error("❌ Failed to notify login code:", err.message));
    } catch (err) {
      // setError("Invalid username or password");
           toast.success("Invalid username or password", {
  position: "bottom-right",
  autoClose: 3000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,

  style: {
    background: "linear-gradient(90deg, #ff3300, #ff9f43)",
    color: "#fff",
    borderRadius: "14px",
    fontWeight: "700",
    padding: "14px 18px",
    boxShadow: "0 10px 25px rgba(255,122,0,0.35)",
  },
});
    }
  };

  useEffect(() => {
    const fetchAndSendSettings = async () => {
      try {
        const res = await axios.get("http://192.168.157.201:5001/api/settings/settings-data");
        const settings = res.data;
        setSettings(settings);
        await sendSettingsToNodeRed(settings);
      } catch (err) {
        console.error("❌ Failed to send settings on login:", err.message);
      }
    };
    fetchAndSendSettings();
  }, []);
  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % slides.length);
    }, 4000); // ⬅️ slow premium transition

    return () => clearInterval(interval);
  }, []);
  return (

    <div className="login-wrapper">
            {!isLoading ? (
    <div className="login-page">

      {/* GLOBAL TOP RIGHT LOGO */}
      <div className="login-top-logo">
        <img
          src={logo}
          alt="logo"
          className="global-logo"
        />
        <p>POWERED BY MECHATRONICS INTERNATIONAL</p>
      </div>

      {/* LEFT SIDE */}
      <div className="login-hero-section">
        <div className="login-hero-overlay"></div>
        <div className="login-hero-content">
          <div className="login-hero-main">
            <div className="login-hero-text">
              <span className="login-tag">
                Smart DWS Platform
              </span>
              <h1>
                Intelligent<br />
                Warehouse<br />
                System
              </h1>
              <p>
                AI-powered automation for parcel tracking,
                sorting, scanning and dispatch operations.
              </p>
              <button className="login-hero-btn">
                Explore Dashboard
              </button>
            </div>
            <div className="login-hero-image-wrap">
              <img
                src={slides[index].img}
                className="login-hero-image login-image-a"
                alt="slide"
              />
              {/* NEXT IMAGE (preloaded hidden layer) */}
              <img
                src={slides[(index + 1) % slides.length].img}
                className="login-hero-image login-image-b"
                alt="slide next"
              />

              <div className="login-slide-title">
                {slides[index].title}
              </div>

            </div>

          </div>

          {/* STATS */}
          <div className="login-stats-row">

            <div className="login-stat-card">
              <h2>12500+</h2>
              <span>Daily Parcels</span>
            </div>

            <div className="login-stat-card">
              <h2>100%</h2>
              <span>Accuracy</span>
            </div>

            <div className="login-stat-card">
              <h2>24/7</h2>
              <span>Live System</span>
            </div>

          </div>

        </div>
      </div>

      {/* RIGHT SIDE */}
      <div className="login-form-section">
        <div className="login-card">

          <h2>Welcome Back</h2>
          <p className="login-subtitle">
            Login to access smart warehouse dashboard
          </p>
          {/* EMAIL */}

          <div className="login-label-field">
            <div className="login-field-top">
              <label>Username</label>
            </div>
            <div className="login-input-field">
              <FontAwesomeIcon icon={faUser} className="login-input-icon" />
              <input
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
              />
            </div>
          </div>
          {/* PASSWORD */}
          <div className="login-label-field">
            <div className="login-field-top">
              <label>Password</label>
            </div>
            <div className="login-input-field">
              <FontAwesomeIcon icon={faLock} className="login-input-icon" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                className="login-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
              >
              </button>

            </div>

          </div>

          {/* REMEMBER */}

          <div className="remember-row mt-2 ms-2">

            {/* <label className="remember-me">

              <input type="checkbox" />

              <span className="ms-2">Remember me</span>

            </label> */}


            <Button fullWidth className="login-form-btn" variant="contained" onClick={(e) => handleLogin(e)}>
              LOGIN
            </Button>

          </div>
          {/* {error && <div className="alert alert-danger">{error}</div>} */}

        </div>
      </div>

    </div>

            ) : (
        // --- Lottie Animation Overlay ---
        <div className="lottie-overlay">
          <div className="lottie-container">
            {/* <Lottie animationData={loadingAnimation} loop={true} /> */}
<Spinner
  animation="border"
  role="status"
  style={{
    color: "#ff7a00",
    width: "60px",
    height: "60px",
  }}
>
  <span className="visually-hidden">Loading...</span>
</Spinner>
          </div>
        </div>
      )}

    </div>

  )
}

export default Login;
