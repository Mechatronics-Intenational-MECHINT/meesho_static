import React, { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import Home from "./Home";
import ManageBins from "./ManageBins";
import Alarms from "./Alarms";
import Calibration from "./Calibration";
import Settings from "./Settings";
import AccessDenied from "./AccessDenied";
import MachineStatusPage from "./MachineStatusPage";
import BoxMasterTable from "./BoxMasterTable";
import ProductionReport from "./ProductionReport";
import AlertLogs from "./AlertLogs";









const Dashboard = () => {
    const [activeComponent, setActiveComponent] = useState("Home");
    const navigate = useNavigate();
    // useEffect(() => {
    //     const showCalibrationAlert = localStorage.getItem("showCalibrationAlert");
    //     if (showCalibrationAlert === "true") {

    //         axios.post("http://localhost:1880/calibration-status", {
    //             calibration: true,
    //             timestamp: new Date().toISOString()  // <-- Adds ISO timestamp
    //         })
    //         .then(() => {
    //             console.log("✅ Sent calibration alert to Node-RED");
    //         })
    //         .catch(err => {
    //             console.error("❌ Failed to send calibration status:", err.message);
    //         });
    //         axios.post("http://localhost:5001/api/calibration-status/update", {
                
    //             timestamp: new Date().toISOString()  // <-- Adds ISO timestamp
    //         })
    //         .then(() => {
    //             console.log("✅ Sent calibration status to backend");
    //         })
    //         .catch(err => {
    //             console.error("❌ Failed to send calibration status:", err.message);
    //         });
    //         Swal.fire({
    //             title: "Calibration Alert!",
    //             text: "Calibration is required. Please calibrate the machine.",
    //             icon: "warning",
    //             confirmButtonText: "OK"
    //         });
    //         localStorage.setItem("showCalibrationAlert", "false");
    //     }
    // }, []);

    if (!localStorage.getItem("token")) {
        return <Navigate to="/login" />;
    }
    const role = localStorage.getItem("role");


    const renderComponent = () => {
        switch (activeComponent) {
            case "Home":
                return <Home />;
            case "Shipments":
                return <ManageBins />;
            case "Alarms History":
                return  <Alarms />;
            case "Calibration":
                return  <Calibration />;
            case "Production Report":
                return <ProductionReport />;
            case "Active Alarms":
                return <MachineStatusPage />;
            case "Alert Logs":
                return <AlertLogs />;
            case "Settings":
                return role === "admin" ? <Settings /> : <AccessDenied />;
            case "DWS Statistics Report":
                return <BoxMasterTable />;
            default:
                return <h3>{activeComponent} Page</h3>;
        }
    };

    

    return (
        <div className="dashboard-container">
            <Navbar />
            <div className="d-flex flex-grow-1">
                <div className="sidebar-container">
                    <Sidebar setActiveComponent={setActiveComponent} />
                </div>
                <div className="main-content">{renderComponent()}</div>
            </div>
        </div>
    );
};

export default Dashboard;
