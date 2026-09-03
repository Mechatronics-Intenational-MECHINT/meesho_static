import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faWarehouse, faRobot, faChevronDown,
  faSliders, faBox, faCog, faChartLine, faBell, faClipboardList,
  faChartBar,
} from "@fortawesome/free-solid-svg-icons";

/* ─── nav structure — grouped by real function, not decoration ─────────── */
const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      { name: "Home",              icon: faWarehouse },
      { name: "Shipments",         icon: faBox },
      { name: "Calibration",       icon: faSliders },
      // { name: "Production Report", icon: faChartLine },
      { name: "Active Alarms",     icon: faBell },
      { name: "Alarms History",    icon: faRobot },
      { name: "Alert Logs",        icon: faClipboardList },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Settings",             icon: faCog },
      // { name: "DWS Statistics Report", icon: faChartBar },
    ],
  },
];

export default function Sidebar({ setActiveComponent, activeComponent }) {
  const [binsOpen, setBinsOpen] = useState(false);

  const isActive = (name) => activeComponent === name;

  const handleKeyActivate = (e, fn) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Mono:wght@400;500&display=swap');

        .sb-root {
          width: 216px;
          min-width: 216px;
          height: 100vh;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          font-family: 'Space Grotesk', sans-serif;
          border-right: 1px solid #EAECEF;
          flex-shrink: 0;
        }

        /* ── BRAND MARK ── */
        .sb-brand {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 20px 18px;
          border-bottom: 1px solid #EAECEF;
        }
        .sb-brand-swatch {
          width: 38px;
          height: 38px;
          min-width: 38px;
          border-radius: 9px;
          background: #D71920;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-size: 16px;
          box-shadow: 0 4px 14px rgba(215,25,32,0.28);
        }
        .sb-brand-text {
          display: flex;
          flex-direction: column;
          line-height: 1.15;
          overflow: hidden;
        }
        .sb-brand-name {
          font-size: 15.5px;
          font-weight: 700;
          color: #111827;
          letter-spacing: 0.2px;
          white-space: nowrap;
        }
        .sb-brand-sub {
          font-family: 'DM Mono', monospace;
          font-size: 9.5px;
          font-weight: 500;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          color: #A0A8B4;
          margin-top: 2px;
          white-space: nowrap;
        }

        /* ── NAV ── */
        .sb-nav {
          flex: 1;
          padding: 16px 10px 10px;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          overflow-x: hidden;
        }
        .sb-nav::-webkit-scrollbar { width: 0; }

        .sb-group + .sb-group { margin-top: 18px; }

        .sb-eyebrow {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          color: #B4BAC4;
          padding: 0 10px 8px;
        }

        /* ── NAV ITEM ── */
        .sb-item {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 9px 11px;
          margin-bottom: 2px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
          font-size: 13px;
          font-weight: 600;
          color: #4B5157;
          border-left: 3px solid transparent;
          position: relative;
          user-select: none;
          white-space: nowrap;
        }
        .sb-item:hover {
          background: #F7F7F8;
          color: #111827;
        }
        .sb-item.active {
          background: #FFF1F1;
          color: #D71920;
          border-left-color: #D71920;
        }
        .sb-item:focus-visible {
          outline: 2px solid #D71920;
          outline-offset: 2px;
        }

        .sb-icon {
          width: 16px;
          text-align: center;
          flex-shrink: 0;
          font-size: 14px;
          color: inherit;
          opacity: 0.85;
        }
        .sb-item.active .sb-icon { opacity: 1; }

        .sb-label { flex: 1; overflow: hidden; text-overflow: ellipsis; color: inherit; }

        .sb-chevron {
          font-size: 9px;
          opacity: 0.5;
          transition: transform 0.2s;
          flex-shrink: 0;
        }
        .sb-chevron.open { transform: rotate(180deg); opacity: 0.8; }

        /* ── SUB ITEMS ── */
        .sb-subnav {
          overflow: hidden;
          max-height: 0;
          transition: max-height 0.25s ease;
        }
        .sb-subnav.open { max-height: 240px; }

        .sb-subitem {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 11px 8px 30px;
          border-radius: 7px;
          cursor: pointer;
          font-size: 12.5px;
          font-weight: 500;
          color: #6B7280;
          transition: background 0.15s, color 0.15s;
          user-select: none;
          white-space: nowrap;
          margin-top: 1px;
        }
        .sb-subitem:hover { background: #F7F7F8; color: #111827; }
        .sb-subitem.active { background: #FFF1F1; color: #D71920; font-weight: 600; }

        /* ── FOOTER ── */
        .sb-foot {
          padding: 12px 18px 16px;
          border-top: 1px solid #EAECEF;
        }
        .sb-foot-version {
          font-family: 'DM Mono', monospace;
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.8px;
          color: #B4BAC4;
        }
      `}</style>

      <div className="sb-root">

        {/* ── Brand mark (replaces removed logo) ── */}
        <div className="sb-brand">
          <div className="sb-brand-swatch">
            <FontAwesomeIcon icon={faWarehouse} />
          </div>
          <div className="sb-brand-text">
            <span className="sb-brand-name"> Console</span>
            <span className="sb-brand-sub">Warehouse Ops</span>
          </div>
        </div>

        {/* ── Navigation ── */}
        <nav className="sb-nav">
          {NAV_GROUPS.map((group) => (
            <div className="sb-group" key={group.label}>
              <div className="sb-eyebrow">{group.label}</div>

              {group.items.map((item) => (
                item.sub ? (
                  <React.Fragment key={item.name}>
                    <div
                      className={`sb-item${isActive(item.name) ? " active" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setBinsOpen((o) => !o)}
                      onKeyDown={(e) => handleKeyActivate(e, () => setBinsOpen((o) => !o))}
                    >
                      <span className="sb-icon"><FontAwesomeIcon icon={item.icon}/></span>
                      <span className="sb-label">{item.name}</span>
                      <span className={`sb-chevron${binsOpen ? " open" : ""}`}>
                        <FontAwesomeIcon icon={faChevronDown}/>
                      </span>
                    </div>
                    <div className={`sb-subnav${binsOpen ? " open" : ""}`}>
                      {item.sub.map((s) => (
                        <div
                          key={s.name}
                          className={`sb-subitem${isActive(s.name) ? " active" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setActiveComponent(s.name)}
                          onKeyDown={(e) => handleKeyActivate(e, () => setActiveComponent(s.name))}
                        >
                          <span className="sb-icon"><FontAwesomeIcon icon={s.icon}/></span>
                          <span>{s.name}</span>
                        </div>
                      ))}
                    </div>
                  </React.Fragment>
                ) : (
                  <div
                    key={item.name}
                    className={`sb-item${isActive(item.name) ? " active" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveComponent(item.name)}
                    onKeyDown={(e) => handleKeyActivate(e, () => setActiveComponent(item.name))}
                  >
                    <span className="sb-icon"><FontAwesomeIcon icon={item.icon}/></span>
                    <span className="sb-label">{item.name}</span>
                  </div>
                )
              ))}
            </div>
          ))}
        </nav>

        {/* ── Footer ── */}
        <div className="sb-foot">
          <span className="sb-foot-version">v8.0</span>
        </div>

      </div>
    </>
  );
}