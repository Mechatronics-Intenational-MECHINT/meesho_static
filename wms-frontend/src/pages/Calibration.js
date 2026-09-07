import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import "../styles/Calibration.css";

const API = "http://localhost:5001/api/calibration-data";

/* ══════════════════════════════ IST UTILS ══════════════════════════════ */
const IST_MS = 5.5 * 3600 * 1000;
const toIST  = (d) => new Date(d.getTime() + IST_MS);
const padZ   = (n) => String(n).padStart(2, "0");

function toISOLocal(utcDate) {
  const i = toIST(utcDate);
  return `${i.getUTCFullYear()}-${padZ(i.getUTCMonth()+1)}-${padZ(i.getUTCDate())}T${padZ(i.getUTCHours())}:${padZ(i.getUTCMinutes())}`;
}

// ✅ FIXED: startOfISTDay/endOfISTDay accept a plain local JS Date
// They build midnight IST expressed as UTC by subtracting IST_MS offset
function startOfISTDay(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0) - IST_MS);
}
function endOfISTDay(d) {
  // +999ms so the entire last second is included
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999) - IST_MS);
}

// ✅ FIXED: use UTC getters after shifting to IST
function fmtIST(rawDate) {
  if (!rawDate) return "—";
  const d = toIST(new Date(rawDate));
  return `${d.getUTCFullYear()}-${padZ(d.getUTCMonth()+1)}-${padZ(d.getUTCDate())} ${padZ(d.getUTCHours())}:${padZ(d.getUTCMinutes())}:${padZ(d.getUTCSeconds())}`;
}

/** Backend expects UTC ISO strings for start/end */
function toUTCISO(date) { return date.toISOString(); }

function buildUTCFromParts(date, h, m) {
  // date is a local JS Date — construct IST time then convert to UTC ISO
  const midnightUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const midnightIST = midnightUTC - IST_MS;
  const chosenIST   = midnightIST + (h * 3600 + m * 60) * 1000;
  return new Date(chosenIST).toISOString();
}

const QUICK_OPTIONS = [
  { val: "today",     label: "Today"       },
  { val: "yesterday", label: "Yesterday"   },
  { val: "last2days", label: "Last 2 days" },
  { val: "last7days", label: "Last 7 days" },
];

// ✅ FIXED: use new Date() (local time) — NOT nowIST() which caused double-shifting
function getQuickRange(val) {
  const now = new Date(); // plain local time
  if (val === "today") {
    return { s: startOfISTDay(now), e: new Date() };
  }
  if (val === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { s: startOfISTDay(y), e: endOfISTDay(y) };
  }
  if (val === "last2days") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { s: startOfISTDay(d), e: new Date() };
  }
  if (val === "last7days") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { s: startOfISTDay(d), e: new Date() };
  }
  return null;
}

/* ══════════════════════════════ TODAY DEFAULT ══════════════════════════════ */
// Called fresh each time (not cached at module load) so date is always current
function getTodayFilter() {
  const r = getQuickRange("today");
  return { start: toUTCISO(r.s), end: toUTCISO(r.e), label: "Today" };
}

/* ══════════════════════════════ CALENDAR WITH TIME ══════════════════════════════ */
const DOW    = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function CalendarWithTime({
  label, accentColor, selected, onSelect,
  hours, minutes, onHoursChange, onMinutesChange,
  rangeStart, rangeEnd,
}) {
  const today = new Date();
  const [view, setView] = useState({
    y: (selected || today).getFullYear(),
    m: (selected || today).getMonth(),
  });

  const firstDay    = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.y, view.m, d));

  const prevM = () => setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 });
  const nextM = () => setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 });
  const spin  = (val, max, dir) => (val + dir + max + 1) % (max + 1);

  return (
    <div className="cb-cal-block">
      <div className="cb-sb-section-label">
        <span style={{ color: accentColor, fontSize: "10px" }}>●</span> {label}
      </div>
      <div className="cb-cal-with-time">
        <div className="cb-cal-wrapper">
          <div className="cb-cal-header">
            <button className="cb-cal-nav" onClick={prevM}>‹</button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button className="cb-cal-nav" onClick={nextM}>›</button>
          </div>
          <div className="cb-cal-grid">
            <div className="cb-cal-dow">{DOW.map(d => <span key={d}>{d}</span>)}</div>
            <div className="cb-cal-days">
              {cells.map((day, i) => {
                if (!day) return <span key={`e${i}`} className="cb-cal-day empty" />;
                const isToday = day.toDateString() === today.toDateString();
                const isSel   = selected && day.toDateString() === selected.toDateString();
                const inRange = rangeStart && rangeEnd && day > rangeStart && day < rangeEnd;
                let cls = "cb-cal-day";
                if (isToday) cls += " today";
                if (isSel)   cls += " selected";
                else if (inRange) cls += " in-range";
                return (
                  <button key={i} className={cls} onClick={() => onSelect(day)}>
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="cb-time-panel">
          <div className="cb-time-panel-head">TIME</div>
          <div className="cb-time-panel-sub">IST · 24H</div>
          <div className="cb-time-spin">
            <button className="cb-time-spin-btn" onClick={() => onHoursChange(spin(hours, 23, 1))}>▲</button>
            <div className="cb-time-display" style={{ borderColor: accentColor, color: accentColor }}>{padZ(hours)}</div>
            <button className="cb-time-spin-btn" onClick={() => onHoursChange(spin(hours, 23, -1))}>▼</button>
          </div>
          <div className="cb-time-colon">:</div>
          <div className="cb-time-spin">
            <button className="cb-time-spin-btn" onClick={() => onMinutesChange(spin(minutes, 59, 1))}>▲</button>
            <div className="cb-time-display" style={{ borderColor: accentColor, color: accentColor }}>{padZ(minutes)}</div>
            <button className="cb-time-spin-btn" onClick={() => onMinutesChange(spin(minutes, 59, -1))}>▼</button>
          </div>
          <div className="cb-time-selected-box" style={{ borderColor: accentColor }}>
            <span className="cb-time-selected-date">
              {selected ? `${padZ(selected.getDate())}/${padZ(selected.getMonth() + 1)}` : "--/--"}
            </span>
            <span className="cb-time-selected-time" style={{ color: accentColor }}>
              {padZ(hours)}:{padZ(minutes)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════ FILTER SIDEBAR ══════════════════════════════ */
function FilterSidebar({ onApply, onClose, initialStart, initialEnd }) {
  const [tab, setTab] = useState("quick");
  const [activeQuick, setActiveQuick] = useState("today");

  // ✅ FIXED: use plain new Date() — not nowIST()
  const todayLocal = new Date();
  const [startDate, setStartDate] = useState(initialStart || todayLocal);
  const [startH,    setStartH]    = useState(0);
  const [startM,    setStartM]    = useState(0);
  const [endDate,   setEndDate]   = useState(initialEnd   || todayLocal);
  const [endH,      setEndH]      = useState(23);
  const [endM,      setEndM]      = useState(59);

  const durMs = useMemo(() => {
    const s = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), startH, startM, 0);
    const e = new Date(endDate.getFullYear(),   endDate.getMonth(),   endDate.getDate(),   endH,   endM,   0);
    return e - s;
  }, [startDate, startH, startM, endDate, endH, endM]);

  const durStr = useMemo(() => {
    if (durMs <= 0) return "Invalid range";
    return `${Math.floor(durMs / 3600000)}h ${padZ(Math.floor((durMs % 3600000) / 60000))}m`;
  }, [durMs]);

  const handleQuickApply = (val) => {
    setActiveQuick(val);
    const r = getQuickRange(val);
    if (!r) return;
    onApply({
      start: toUTCISO(r.s),
      end:   toUTCISO(r.e),
      label: QUICK_OPTIONS.find(o => o.val === val)?.label || val,
    });
  };

  const handleCustomApply = () => {
    if (durMs <= 0) { alert("End must be after start."); return; }
    onApply({
      start: buildUTCFromParts(startDate, startH, startM),
      end:   buildUTCFromParts(endDate,   endH,   endM),
      label: `${padZ(startDate.getDate())}/${padZ(startDate.getMonth()+1)} ${padZ(startH)}:${padZ(startM)} → ${padZ(endDate.getDate())}/${padZ(endDate.getMonth()+1)} ${padZ(endH)}:${padZ(endM)} IST`,
    });
  };

  return (
    <>
      <div className="cb-sidebar-overlay" onClick={onClose} />
      <div className="cb-sidebar">
        <div className="cb-sb-header">
          <div className="cb-sb-title">
            <div className="cb-sb-title-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <path d="M16 2v4M8 2v4M3 10h18"/>
              </svg>
            </div>
            <div>
              <h3>Date &amp; Time Filter</h3>
              <p>All times shown in IST</p>
            </div>
          </div>
          <button className="cb-sb-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="cb-sb-tabs">
          <button className={`cb-sb-tab${tab === "quick" ? " active" : ""}`} onClick={() => setTab("quick")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            Quick
          </button>
          <button className={`cb-sb-tab${tab === "custom" ? " active" : ""}`} onClick={() => setTab("custom")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            Custom
          </button>
        </div>

        <div className="cb-sb-body">
          {tab === "quick" ? (
            <>
              <div className="cb-sb-section-label" style={{ marginTop: 0 }}>Select range</div>
              <div className="cb-quick-grid">
                {QUICK_OPTIONS.map(o => (
                  <button
                    key={o.val}
                    className={`cb-quick-btn${activeQuick === o.val ? " active" : ""}`}
                    onClick={() => handleQuickApply(o.val)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <CalendarWithTime
                label="Start" accentColor="#2563eb"
                selected={startDate} onSelect={setStartDate}
                hours={startH} minutes={startM}
                onHoursChange={setStartH} onMinutesChange={setStartM}
                rangeStart={startDate} rangeEnd={endDate}
              />
              <CalendarWithTime
                label="End" accentColor="#f97316"
                selected={endDate} onSelect={setEndDate}
                hours={endH} minutes={endM}
                onHoursChange={setEndH} onMinutesChange={setEndM}
                rangeStart={startDate} rangeEnd={endDate}
              />
              <div className={`cb-duration${durMs <= 0 ? " warn" : ""}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke={durMs > 0 ? "#15803d" : "#c2410c"} strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
                <span>Duration: {durStr}</span>
              </div>
              <button className="cb-sb-apply" onClick={handleCustomApply}>Apply Range</button>
            </>
          )}
        </div>

        {tab === "quick" && (
          <div className="cb-sb-footer">
            <button className="cb-sb-cancel" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════ DOUGHNUT CHART (canvas) ══════════════════════════════ */
function DonutChart({ pass, fail }) {
  const canvasRef = useRef(null);
  const total   = pass + fail;
  const passPct = total ? Math.round((pass / total) * 100) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx       = canvas.getContext("2d");
    const W         = canvas.width, H = canvas.height;
    const cx        = W / 2, cy = H / 2;
    const r         = Math.min(W, H) / 2 - 8;
    const thickness = 28;

    ctx.clearRect(0, 0, W, H);

    const draw = (startAngle, sweepAngle, color) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, startAngle + sweepAngle);
      ctx.arc(cx, cy, r - thickness, startAngle + sweepAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx, cy, r - thickness, Math.PI * 2, 0, true);
      ctx.closePath();
      ctx.fillStyle = "#e5e7eb";
      ctx.fill();
      return;
    }

    const passAngle = (pass / total) * Math.PI * 2;
    const failAngle = Math.PI * 2 - passAngle;
    const start     = -Math.PI / 2;

    draw(start, passAngle, "#10b981");
    if (failAngle > 0.01) draw(start + passAngle, failAngle, "#ef4444");

    ctx.strokeStyle = "#fff";
    ctx.lineWidth   = 2;
    [start, start + passAngle].forEach(angle => {
      if (passAngle > 0.01 && failAngle > 0.01) {
        ctx.beginPath();
        ctx.moveTo(cx + (r - thickness) * Math.cos(angle), cy + (r - thickness) * Math.sin(angle));
        ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
        ctx.stroke();
      }
    });
  }, [pass, fail, total]);

  return (
    <div className="cb-donut-wrap">
      <canvas ref={canvasRef} width={160} height={160} />
      <div className="cb-donut-center">
        <div className="cb-donut-center-pct">{passPct}%</div>
        <div className="cb-donut-center-label">Accuracy</div>
      </div>
    </div>
  );
}

/* ══════════════════════════════ STATUS BADGE ══════════════════════════════ */
function StatusBadge({ value }) {
  const s = String(value || "").toLowerCase();
  if (s === "pass") return <span className="cb-badge-pass">✓ pass</span>;
  if (s === "fail") return <span className="cb-badge-fail">✗ fail</span>;
  return <span className="cb-badge-unknown">{value || "—"}</span>;
}

/* ══════════════════════════════ VARIANCE CELL ══════════════════════════════ */
function VarCell({ value }) {
  const n = parseFloat(value);
  if (isNaN(n) || n === 0) return <span className="cb-var-zero">0</span>;
  const cls = n > 0 ? "cb-var-pos" : "cb-var-neg";
  return <span className={cls}>{n > 0 ? "+" : ""}{n}</span>;
}

/* ══════════════════════════════ COLUMNS ══════════════════════════════ */
const COLUMNS = [
  { key: "sno",               label: "S.No",      width: "52px",  sortable: false },
  { key: "barcode",           label: "Barcode",    width: "150px", sortable: true  },
  { key: "length",            label: "L",          width: "60px",  sortable: true  },
  { key: "width",             label: "W",          width: "60px",  sortable: true  },
  { key: "height",            label: "H",          width: "60px",  sortable: true  },
  { key: "weight",            label: "Wt",         width: "60px",  sortable: true  },
  { key: "volumetricWeight",  label: "Vol Wt",     width: "80px",  sortable: true  },
  { key: "lengthStatus",      label: "L Status",   width: "85px",  sortable: true  },
  { key: "widthStatus",       label: "W Status",   width: "85px",  sortable: true  },
  { key: "heightStatus",      label: "H Status",   width: "85px",  sortable: true  },
  { key: "dimensionResult",   label: "Dim Result", width: "90px",  sortable: true  },
  { key: "weightStatus",      label: "Wt Status",  width: "85px",  sortable: true  },
  { key: "finalResult",       label: "Final",      width: "80px",  sortable: true  },
  { key: "lengthVariance",    label: "L Var",      width: "72px",  sortable: true  },
  { key: "widthVariance",     label: "W Var",      width: "72px",  sortable: true  },
  { key: "heightVariance",    label: "H Var",      width: "72px",  sortable: true  },
  { key: "weightVariance",    label: "Wt Var",     width: "72px",  sortable: true  },
  { key: "dimensionTolerance",label: "Dim Tol",    width: "80px",  sortable: false },
  { key: "weightTolerance",   label: "Wt Tol",     width: "72px",  sortable: false },
  { key: "timestamp",         label: "Timestamp",  width: "150px", sortable: true  },
];

/* ══════════════════════════════ MAIN COMPONENT ══════════════════════════════ */
export default function Calibration() {
  /* ── sidebar ── */
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [badgeText,    setBadgeText]    = useState("Today");
  const [activeFilter, setActiveFilter] = useState(null); // set on mount via useEffect

  /* ── search ── */
  const [search, setSearch] = useState("");

  /* ── table ── */
  const [data,         setData]         = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page,         setPage]         = useState(1);
  const [rowsPerPage,  setRowsPerPage]  = useState(25);
  const [loading,      setLoading]      = useState(false);
  const [sortKey,      setSortKey]      = useState("timestamp");
  const [sortDir,      setSortDir]      = useState("desc");

  /* ── summary ── */
  const [summary,        setSummary]        = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  /* ── fetch table data ── */
  const fetchData = useCallback(async (pg, rws, filter, srch) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, limit: rws });
      if ((srch || "").trim()) params.set("search", srch.trim());
      if (filter?.start && filter?.end) {
        params.set("start", filter.start);
        params.set("end",   filter.end);
      }
      console.log("[Calibration] fetching:", `${API}/dimension-status?${params}`);
      const res  = await fetch(`${API}/dimension-status?${params}`);
      const json = await res.json();
      console.log("[Calibration] response:", json.success, "total:", json.total, "data:", json.data?.length);
      if (json.success) {
        setData(json.data || []);
        setTotalRecords(json.total || 0);
      }
    } catch (err) {
      console.error("Calibration fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── fetch summary ── */
  const fetchSummary = useCallback(async (filter) => {
    setSummaryLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter?.start && filter?.end) {
        params.set("start", filter.start);
        params.set("end",   filter.end);
      } else {
        params.set("range", "today");
      }
      console.log("[Calibration] summary fetch:", `${API}/summary?${params}`);
      const res  = await fetch(`${API}/summary?${params}`);
      const json = await res.json();
      console.log("[Calibration] summary response:", json);
      if (json.success) setSummary(json.data);
    } catch (err) {
      console.error("Summary fetch:", err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // ✅ On mount: compute fresh today filter and load data
  useEffect(() => {
    const f = getTodayFilter();
    setActiveFilter({ start: f.start, end: f.end });
    setBadgeText(f.label);
    fetchData(1, 25, { start: f.start, end: f.end }, "");
    fetchSummary({ start: f.start, end: f.end });
  }, [fetchData, fetchSummary]);

  /* ── sidebar apply ── */
  const handleSidebarApply = ({ start, end, label }) => {
    const f = { start, end };
    setActiveFilter(f);
    setBadgeText(label);
    setSidebarOpen(false);
    setPage(1);
    fetchData(1, rowsPerPage, f, search);
    fetchSummary(f);
  };

  const handleSearch = () => {
    setPage(1);
    fetchData(1, rowsPerPage, activeFilter, search);
  };

  const handleReset = () => {
    const f = getTodayFilter();
    setSearch("");
    setActiveFilter({ start: f.start, end: f.end });
    setBadgeText(f.label);
    setPage(1);
    fetchData(1, rowsPerPage, { start: f.start, end: f.end }, "");
    fetchSummary({ start: f.start, end: f.end });
  };

  /* ── pagination ── */
  const totalPages = Math.max(1, Math.ceil(totalRecords / rowsPerPage));

  const handlePageChange = (pg) => {
    const p = Math.max(1, Math.min(pg, totalPages));
    setPage(p);
    fetchData(p, rowsPerPage, activeFilter, search);
  };

  const handleRowsChange = (n) => {
    setRowsPerPage(n);
    setPage(1);
    fetchData(1, n, activeFilter, search);
  };

  /* ── sort ── */
  const handleSort = (key) => {
    const dir = sortKey === key && sortDir === "asc" ? "desc" : "asc";
    setSortKey(key);
    setSortDir(dir);
  };

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      let av = a[sortKey] ?? "", bv = b[sortKey] ?? "";
      if (!isNaN(av) && !isNaN(bv)) { av = Number(av); bv = Number(bv); }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  /* ── export ── */
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim())        params.set("search", search.trim());
      if (activeFilter?.start)  params.set("start",  activeFilter.start);
      if (activeFilter?.end)    params.set("end",    activeFilter.end);
      const res  = await fetch(`${API}/dimension-status/export?${params}`);
      const json = await res.json();
      if (!json.success || !json.data?.length) { alert("No data to export."); return; }
      const rows = json.data.map(r => ({
        Barcode:          r.barcode,
        Length:           r.length,
        Width:            r.width,
        Height:           r.height,
        Weight:           r.weight,
        VolumetricWeight: r.volumetricWeight,
        CalibrateLength:  r.calibrateLength,
        CalibrateWidth:   r.calibrateWidth,
        CalibrateHeight:  r.calibrateHeight,
        CalibrateWeight:  r.calibrateWeight,
        DimTolerance:     r.dimensionTolerance,
        WtTolerance:      r.weightTolerance,
        LengthStatus:     r.lengthStatus,
        WidthStatus:      r.widthStatus,
        HeightStatus:     r.heightStatus,
        WeightStatus:     r.weightStatus,
        DimResult:        r.dimensionResult,
        FinalResult:      r.finalResult,
        LengthVar:        r.lengthVariance,
        WidthVar:         r.widthVariance,
        HeightVar:        r.heightVariance,
        WeightVar:        r.weightVariance,
        Timestamp:        fmtIST(r.timestamp),
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Calibration");
      XLSX.writeFile(wb, `calibration-${Date.now()}.xlsx`);
    } catch (err) {
      console.error(err);
      alert("Export failed.");
    }
  };

  const handleClear = async () => {
    if (!window.confirm("Delete ALL calibration data? This cannot be undone.")) return;
    try {
      await fetch(`${API}/dimension-status`, { method: "DELETE" });
      setData([]);
      setTotalRecords(0);
      setSummary(null);
    } catch (err) {
      console.error(err);
      alert("Failed.");
    }
  };

  /* ── page number list ── */
  const pageNums = useMemo(() => {
    const nums = [];
    const delta = 2;
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= page - delta && p <= page + delta)) {
        nums.push(p);
      } else if (nums[nums.length - 1] !== "...") {
        nums.push("...");
      }
    }
    return nums;
  }, [page, totalPages]);

  /* ══════════════════════════════ RENDER ══════════════════════════════ */
  return (
    <div className="cb-root">
      {loading && (
        <div className="cb-loader">
          <div className="cb-spinner" />
          <p className="cb-loader-text">Loading calibration data…</p>
        </div>
      )}

      {/* ✅ FIXED: pass plain new Date() — not nowIST() */}
      {sidebarOpen && (
        <FilterSidebar
          onApply={handleSidebarApply}
          onClose={() => setSidebarOpen(false)}
          initialStart={new Date()}
          initialEnd={new Date()}
        />
      )}

      {/* ══ TOP BAR ══ */}
      <div className="cb-topbar">
        <div className="cb-brand">
          <span className="cb-brand-dot" />
          Calibration
        </div>
        <div className="cb-sep" />

        <div className="cb-search-wrap">
          <span className="cb-search-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </span>
          <input
            className="cb-search"
            placeholder="Search barcode…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
          />
        </div>

        <div className="cb-sep" />
        <span className={`cb-badge${activeFilter?.start ? "" : " no-filter"}`}>{badgeText}</span>

        <div className="cb-topbar-right">
          <button className="cb-btn" onClick={handleSearch}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            Query
          </button>
          <button className="cb-btn" onClick={handleReset}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
            </svg>
            Reset
          </button>
          <button className="cb-btn cb-btn-export" onClick={handleExport}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8M5 7l3 3 3-3M3 13h10"/>
            </svg>
            Export
          </button>
          <button className="cb-btn cb-btn-clear" onClick={handleClear}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/>
            </svg>
            Clear All
          </button>
          <button className="cb-btn cb-btn-filter" onClick={() => setSidebarOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
            </svg>
            Date &amp; Time Filter
          </button>
        </div>
      </div>

      {/* ══ BODY ══ */}
      <div className={`cb-body${sidebarOpen ? " sidebar-open" : ""}`}>

        {/* ── Summary section ── */}
        <div className="cb-summary-section">
          <div className="cb-summary-header">
            <div className="cb-summary-title">
              <span className="cb-summary-title-dot" />
              Calibration Summary
            </div>
            <span style={{ fontSize: "11px", color: "var(--cb-text-muted)", fontWeight: 500 }}>
              Showing: <strong style={{ color: "var(--cb-accent)" }}>{badgeText}</strong>
            </span>
          </div>

          {summaryLoading ? (
            <div className="cb-summary-empty">
              <div className="cb-summary-spinner" />
              <span>Loading summary…</span>
            </div>
          ) : summary ? (
            <div className="cb-summary-body">
              <div className="cb-summary-stats">
                {[
                  { icon: "📦", label: "Total Boxes",    val: summary.totalBoxes,                                          cls: "cb-tile-blue",   sub: "scanned"                                                  },
                  { icon: "✅", label: "Total Pass",      val: summary.totalAccuracyCount,                                  cls: "cb-tile-green",  sub: `${summary.totalAccuracyPercent?.toFixed(1)}%`             },
                  { icon: "✗",  label: "Total Fail",      val: (summary.totalBoxes||0) - (summary.totalAccuracyCount||0),   cls: "cb-tile-red",    sub: `${(100 - (summary.totalAccuracyPercent||0)).toFixed(1)}%` },
                  { icon: "📐", label: "Dim Accurate",    val: summary.dimensionAccurateCount,                              cls: "cb-tile-purple", sub: `${summary.dimensionAccuracyPercent?.toFixed(1)}%`         },
                  { icon: "⚖️", label: "Weight Accurate", val: summary.weightAccurateCount,                                 cls: "cb-tile-teal",   sub: `${summary.weightAccuracyPercent?.toFixed(1)}%`            },
                  { icon: "🎯", label: "Dim Accuracy",    val: `${summary.dimensionAccuracyPercent?.toFixed(1)}%`,          cls: "cb-tile-amber",  sub: "dimension"                                               },
                  { icon: "⚡", label: "Weight Accuracy", val: `${summary.weightAccuracyPercent?.toFixed(1)}%`,             cls: "cb-tile-purple", sub: "weight"                                                  },
                ].map(t => (
                  <div key={t.label} className={`cb-stat-tile ${t.cls}`}>
                    <div className="cb-stat-tile-icon">{t.icon}</div>
                    <div className="cb-stat-tile-label">{t.label}</div>
                    <div className="cb-stat-tile-value">{t.val ?? "—"}</div>
                    {t.sub && <div className="cb-stat-tile-sub">{t.sub}</div>}
                  </div>
                ))}
              </div>

              <div className="cb-donut-panel">
                <DonutChart
                  pass={summary.totalAccuracyCount || 0}
                  fail={(summary.totalBoxes || 0) - (summary.totalAccuracyCount || 0)}
                />
                <div className="cb-donut-legend">
                  <div className="cb-donut-legend-item">
                    <div className="cb-donut-legend-dot" style={{ background: "#10b981" }} />
                    Pass
                  </div>
                  <div className="cb-donut-legend-item">
                    <div className="cb-donut-legend-dot" style={{ background: "#ef4444" }} />
                    Fail
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="cb-summary-empty">
              <span style={{ fontSize: "32px" }}>📊</span>
              <span>No data — click Refresh to load summary</span>
            </div>
          )}
        </div>

        {/* ── Table card ── */}
        <div className="cb-table-card">
          <div className="cb-table-header">
            <div className="cb-table-title">
              Calibration Records
              <span className="cb-table-count">{sortedData.length} of {totalRecords.toLocaleString()}</span>
            </div>
            <span className="cb-table-hint">Sorted by latest first</span>
          </div>

          <div className="cb-table-scroll">
            {sortedData.length === 0 && !loading ? (
              <div className="cb-empty">
                <div className="cb-empty-icon">🔬</div>
                <div className="cb-empty-text">No calibration records — adjust filters</div>
              </div>
            ) : (
              <table className="cb-table">
                <colgroup>
                  {COLUMNS.map(c => <col key={c.key} style={{ width: c.width }} />)}
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNS.map(c => {
                      const isActive = sortKey === c.key;
                      return (
                        <th
                          key={c.key}
                          className={`${c.sortable ? "sortable" : ""} ${isActive ? "sort-" + sortDir : ""}`}
                          onClick={() => c.sortable && handleSort(c.key)}
                        >
                          {c.label}
                          {c.sortable && (
                            <span className="sort-icon">
                              {isActive ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedData.map((row, idx) => (
                    <tr key={row._id?.$oid || row._id || idx}>
                      <td style={{ textAlign: "center", color: "var(--cb-text-muted)", fontSize: "11px" }}>
                        {(page - 1) * rowsPerPage + idx + 1}
                      </td>
                      <td className="mono" title={row.barcode}>{row.barcode}</td>
                      <td>{row.length}</td>
                      <td>{row.width}</td>
                      <td>{row.height}</td>
                      <td>{row.weight}</td>
                      <td>{row.volumetricWeight ?? "—"}</td>
                      <td><StatusBadge value={row.lengthStatus} /></td>
                      <td><StatusBadge value={row.widthStatus} /></td>
                      <td><StatusBadge value={row.heightStatus} /></td>
                      <td><StatusBadge value={row.dimensionResult} /></td>
                      <td><StatusBadge value={row.weightStatus} /></td>
                      <td><StatusBadge value={row.finalResult} /></td>
                      <td><VarCell value={row.lengthVariance} /></td>
                      <td><VarCell value={row.widthVariance} /></td>
                      <td><VarCell value={row.heightVariance} /></td>
                      <td><VarCell value={row.weightVariance} /></td>
                      <td title={row.dimensionTolerance}>{row.dimensionTolerance}</td>
                      <td>{row.weightTolerance}</td>
                      <td className="mono">{fmtIST(row.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          <div className="cb-pagination">
            <div className="cb-pagination-left">
              <span className="cb-pagination-info">Rows per page:</span>
              <select
                className="cb-rows-select"
                value={rowsPerPage}
                onChange={e => handleRowsChange(Number(e.target.value))}
              >
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="cb-pagination-info">
                Page {page} of {totalPages} · {totalRecords.toLocaleString()} total
              </span>
            </div>
            <div className="cb-pagination-right">
              <button className="cb-page-btn" disabled={page <= 1} onClick={() => handlePageChange(1)}>«</button>
              <button className="cb-page-btn" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>‹</button>
              {pageNums.map((p, i) =>
                p === "..."
                  ? <span key={`el${i}`} style={{ padding: "0 3px", color: "var(--cb-text-muted)", fontSize: "12px" }}>…</span>
                  : <button key={p} className={`cb-page-btn${p === page ? " active" : ""}`} onClick={() => handlePageChange(p)}>{p}</button>
              )}
              <button className="cb-page-btn" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>›</button>
              <button className="cb-page-btn" disabled={page >= totalPages} onClick={() => handlePageChange(totalPages)}>»</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}