import React from "react";
import { useNavigate } from "react-router-dom";
import "../styles/AccessDenied.css";
import deniedImg from "../assets/403.png"; // You must convert your uploaded image to PNG or use a custom SVG/icon

const AccessDenied = () => {
  const navigate = useNavigate();

  return (
    <div className="access-denied-container">
      <img src={deniedImg} alt="403 Forbidden" className="access-image" />
      <h2>We are Sorry...</h2>
      <p>The page you're trying to access has restricted access.<br />Please refer to your system administrator.</p>
    </div>
  );
};

export default AccessDenied;
