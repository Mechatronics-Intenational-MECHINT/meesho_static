import React, { useState, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import "../styles/ManageBins.css";

const API = "http://localhost:5001/api/boxdata";

/* ══════════════════════════════ IST UTILS ══════════════════════════════ */
const IST_MS = 5.5 * 3600 * 1000;
const padZ   = (n) => String(n).padStart(2, "0");

function nowIST() {
  return new Date(new Date().getTime() + IST_MS);
}

function fmtIST(rawDate) {
  if (!rawDate) return "—";
  const d = new Date(new Date(rawDate).getTime() + IST_MS);
  return `${d.getUTCFullYear()}-${padZ(d.getUTCMonth()+1)}-${padZ(d.getUTCDate())} ${padZ(d.getUTCHours())}:${padZ(d.getUTCMinutes())}:${padZ(d.getUTCSeconds())}`;
}

function toBackendIST(date, h, m) {
  return `${date.getFullYear()}-${padZ(date.getMonth()+1)}-${padZ(date.getDate())} ${padZ(h)}:${padZ(m)}:00`;
}

function getTodayRange() {
  const now   = new Date();
  const ist   = new Date(now.getTime() + IST_MS);
  const y     = ist.getUTCFullYear();
  const mo    = ist.getUTCMonth() + 1;
  const d     = ist.getUTCDate();
  const h     = ist.getUTCHours();
  const mi    = ist.getUTCMinutes();
  const s     = ist.getUTCSeconds();
  return {
    startIST: `${y}-${padZ(mo)}-${padZ(d)} 00:00:00`,
    endIST:   `${y}-${padZ(mo)}-${padZ(d)} ${padZ(h)}:${padZ(mi)}:${padZ(s)}`,
    label:    "Today",
  };
}

const QUICK_OPTIONS = [
  { val:"today",     label:"Today"       },
  { val:"yesterday", label:"Yesterday"   },
  { val:"last2days", label:"Last 2 days" },
  { val:"last7days", label:"Last 7 days" },
];

function getQuickRange(val) {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_MS);
  const y   = ist.getUTCFullYear();
  const mo  = ist.getUTCMonth();
  const d   = ist.getUTCDate();
  const h   = ist.getUTCHours();
  const mi  = ist.getUTCMinutes();

  if (val === "today") {
    return {
      startIST: `${y}-${padZ(mo+1)}-${padZ(d)} 00:00:00`,
      endIST:   `${y}-${padZ(mo+1)}-${padZ(d)} ${padZ(h)}:${padZ(mi)}:59`,
    };
  }
  if (val === "yesterday") {
    const yd = new Date(Date.UTC(y, mo, d - 1));
    return {
      startIST: `${yd.getUTCFullYear()}-${padZ(yd.getUTCMonth()+1)}-${padZ(yd.getUTCDate())} 00:00:00`,
      endIST:   `${yd.getUTCFullYear()}-${padZ(yd.getUTCMonth()+1)}-${padZ(yd.getUTCDate())} 23:59:59`,
    };
  }
  if (val === "last2days") {
    const sd = new Date(Date.UTC(y, mo, d - 1));
    return {
      startIST: `${sd.getUTCFullYear()}-${padZ(sd.getUTCMonth()+1)}-${padZ(sd.getUTCDate())} 00:00:00`,
      endIST:   `${y}-${padZ(mo+1)}-${padZ(d)} ${padZ(h)}:${padZ(mi)}:59`,
    };
  }
  if (val === "last7days") {
    const sd = new Date(Date.UTC(y, mo, d - 6));
    return {
      startIST: `${sd.getUTCFullYear()}-${padZ(sd.getUTCMonth()+1)}-${padZ(sd.getUTCDate())} 00:00:00`,
      endIST:   `${y}-${padZ(mo+1)}-${padZ(d)} ${padZ(h)}:${padZ(mi)}:59`,
    };
  }
  return null;
}

/* ══════════════════════════════ CALENDAR WITH TIME ══════════════════════════════ */
const DOW    = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function CalendarWithTime({ label, accentColor, selected, onSelect, hours, minutes, onHoursChange, onMinutesChange, rangeStart, rangeEnd }) {
  const today = nowIST();
  const [view, setView] = useState({ y:(selected||today).getFullYear(), m:(selected||today).getMonth() });
  const firstDay    = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m+1, 0).getDate();
  const cells = [];
  for (let i=0; i<firstDay; i++) cells.push(null);
  for (let d=1; d<=daysInMonth; d++) cells.push(new Date(view.y, view.m, d));
  const prevM = () => setView(v => v.m===0?{y:v.y-1,m:11}:{y:v.y,m:v.m-1});
  const nextM = () => setView(v => v.m===11?{y:v.y+1,m:0}:{y:v.y,m:v.m+1});
  const spin  = (val,max,dir) => (val+dir+max+1)%(max+1);

  return (
    <div className="mb-cal-block">
      <div className="mb-sb-section-label">
        <span style={{color:accentColor,fontSize:"10px"}}>●</span> {label}
      </div>
      <div className="mb-cal-with-time">
        <div className="mb-cal-wrapper">
          <div className="mb-cal-header">
            <button className="mb-cal-nav" onClick={prevM}>‹</button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button className="mb-cal-nav" onClick={nextM}>›</button>
          </div>
          <div className="mb-cal-grid">
            <div className="mb-cal-dow">{DOW.map(d=><span key={d}>{d}</span>)}</div>
            <div className="mb-cal-days">
              {cells.map((day,i) => {
                if (!day) return <span key={`e${i}`} className="mb-cal-day empty"/>;
                const isToday = day.toDateString()===today.toDateString();
                const isSel   = selected && day.toDateString()===selected.toDateString();
                const inRange = rangeStart&&rangeEnd&&day>rangeStart&&day<rangeEnd;
                let cls="mb-cal-day";
                if(isToday) cls+=" today";
                if(isSel)   cls+=" selected";
                else if(inRange) cls+=" in-range";
                return <button key={i} className={cls} onClick={()=>onSelect(day)}>{day.getDate()}</button>;
              })}
            </div>
          </div>
        </div>
        <div className="mb-time-panel">
          <div className="mb-time-panel-head">TIME</div>
          <div className="mb-time-panel-sub">IST · 24H</div>
          <div className="mb-time-spin">
            <button className="mb-time-spin-btn" onClick={()=>onHoursChange(spin(hours,23,1))}>▲</button>
            <div className="mb-time-display" style={{borderColor:accentColor,color:accentColor}}>{padZ(hours)}</div>
            <button className="mb-time-spin-btn" onClick={()=>onHoursChange(spin(hours,23,-1))}>▼</button>
          </div>
          <div className="mb-time-colon">:</div>
          <div className="mb-time-spin">
            <button className="mb-time-spin-btn" onClick={()=>onMinutesChange(spin(minutes,59,1))}>▲</button>
            <div className="mb-time-display" style={{borderColor:accentColor,color:accentColor}}>{padZ(minutes)}</div>
            <button className="mb-time-spin-btn" onClick={()=>onMinutesChange(spin(minutes,59,-1))}>▼</button>
          </div>
          <div className="mb-time-selected-box" style={{borderColor:accentColor}}>
            <span className="mb-time-selected-date">
              {selected?`${padZ(selected.getDate())}/${padZ(selected.getMonth()+1)}`:"--/--"}
            </span>
            <span className="mb-time-selected-time" style={{color:accentColor}}>
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
  const [activeQuick, setActiveQuick] = useState("");
  const todayIST = nowIST();
  const [startDate,setStartDate] = useState(initialStart||todayIST);
  const [startH,   setStartH]    = useState(0);
  const [startM,   setStartM]    = useState(0);
  const [endDate,  setEndDate]   = useState(initialEnd  ||todayIST);
  const [endH,     setEndH]      = useState(23);
  const [endM,     setEndM]      = useState(59);

  const buildIST = (date,h,m) =>
    `${date.getFullYear()}-${padZ(date.getMonth()+1)}-${padZ(date.getDate())}T${padZ(h)}:${padZ(m)}`;

  const durMs = useMemo(()=>
    new Date(buildIST(endDate,endH,endM)+"+05:30") - new Date(buildIST(startDate,startH,startM)+"+05:30"),
    [startDate,startH,startM,endDate,endH,endM]);

  const durStr = useMemo(()=>{
    if(durMs<=0) return "Invalid range";
    return `${Math.floor(durMs/3600000)}h ${padZ(Math.floor((durMs%3600000)/60000))}m`;
  },[durMs]);

  const handleQuickApply = (val) => {
    setActiveQuick(val);
    const r = getQuickRange(val);
    if (!r) return;
    onApply({
      startIST: r.startIST,
      endIST:   r.endIST,
      label:    QUICK_OPTIONS.find(o=>o.val===val)?.label || val,
    });
  };

  const handleCustomApply = () => {
    if (durMs<=0) { alert("End must be after start."); return; }
    onApply({
      startIST: toBackendIST(startDate,startH,startM),
      endIST:   toBackendIST(endDate,endH,endM),
      label:`${padZ(startDate.getDate())}/${padZ(startDate.getMonth()+1)} ${padZ(startH)}:${padZ(startM)} → ${padZ(endDate.getDate())}/${padZ(endDate.getMonth()+1)} ${padZ(endH)}:${padZ(endM)} IST`,
    });
  };

  return (
    <>
      <div className="mb-sidebar-overlay" onClick={onClose}/>
      <div className="mb-sidebar">
        <div className="mb-sb-header">
          <div className="mb-sb-title">
            <div className="mb-sb-title-icon">
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
          <button className="mb-sb-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="mb-sb-tabs">
          <button className={`mb-sb-tab${tab==="quick"?" active":""}`} onClick={()=>setTab("quick")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            Quick
          </button>
          <button className={`mb-sb-tab${tab==="custom"?" active":""}`} onClick={()=>setTab("custom")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            Custom
          </button>
        </div>
        <div className="mb-sb-body">
          {tab==="quick" ? (
            <>
              <div className="mb-sb-section-label" style={{marginTop:0}}>Select range</div>
              <div className="mb-quick-grid">
                {QUICK_OPTIONS.map(o=>(
                  <button key={o.val} className={`mb-quick-btn${activeQuick===o.val?" active":""}`}
                    onClick={()=>handleQuickApply(o.val)}>{o.label}</button>
                ))}
              </div>
            </>
          ) : (
            <>
              <CalendarWithTime label="Start" accentColor="#2563eb"
                selected={startDate} onSelect={setStartDate}
                hours={startH} minutes={startM}
                onHoursChange={setStartH} onMinutesChange={setStartM}
                rangeStart={startDate} rangeEnd={endDate}/>
              <CalendarWithTime label="End" accentColor="#f97316"
                selected={endDate} onSelect={setEndDate}
                hours={endH} minutes={endM}
                onHoursChange={setEndH} onMinutesChange={setEndM}
                rangeStart={startDate} rangeEnd={endDate}/>
              <div className={`mb-duration${durMs<=0?" warn":""}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke={durMs>0?"#15803d":"#c2410c"} strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
                <span>Duration: {durStr}</span>
              </div>
              <button className="mb-sb-apply" onClick={handleCustomApply}>Apply Range</button>
            </>
          )}
        </div>
        {tab==="quick" && (
          <div className="mb-sb-footer">
            <button className="mb-sb-cancel" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════ IMAGE POPUP MODAL ══════════════════════════════ */
function ImageModal({ row, onClose }) {
  useEffect(() => {
    if (!row) return;
    const fn = (e) => { if (e.key==="Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose, row]);

  if (!row) return null;

  const hasImage = row.imagePath && row.imagePath !== "image_missing";
  const imgSrc   = hasImage ? `http://localhost:5001${row.imagePath}` : null;
  const status   = (row.status||"").toLowerCase();

  const details = [
    { label:"Barcode",    val: row.barcode },
    { label:"L × B × H", val: `${row.length}×${row.breadth}×${row.height}` },
    { label:"Weight",     val: row.weight  },
    { label:"Volume",     val: row.Volume  },
    { label:"Date (IST)", val: row.dateIST || fmtIST(row.createdAt) },
    { label:"Inscan",     val: row.inscanSent },
    { label:"Log Sync",   val: row.logSent    },
    { label:"Image Sync", val: row.imageSent  },
  ];

  return (
    <div className="mb-img-modal-overlay" onClick={onClose}>
      <div className="mb-img-modal" onClick={e=>e.stopPropagation()}>
        <div className="mb-img-modal-header">
          <div className="mb-img-modal-barcode">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/>
            </svg>
            {row.barcode}
          </div>
          <div className="mb-img-modal-status">
            <span className={`mb-status-badge ${status==="pass"?"pass":status==="fail"?"fail":"unknown"}`}>
              {status==="pass"?"✓":"✗"} {row.status||"?"}
            </span>
            <button className="mb-img-modal-close" onClick={onClose}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="mb-img-modal-body">
          {imgSrc ? (
            <img src={imgSrc} alt={row.barcode} className="mb-img-modal-img"
              onError={e => {
                e.target.style.display="none";
                e.target.nextSibling.style.display="flex";
              }}
            />
          ) : null}
          <div className="mb-img-modal-no-img"
            style={{display: imgSrc ? "none" : "flex"}}>
            <span>📷</span>
            No image available for this barcode
          </div>
        </div>
        <div className="mb-img-modal-footer">
          <div className="mb-img-modal-details">
            {details.map(d => (
              <div className="mb-img-modal-detail" key={d.label}>
                <span className="mb-img-modal-detail-label">{d.label}</span>
                <span className="mb-img-modal-detail-val">{d.val||"—"}</span>
              </div>
            ))}
          </div>
          {imgSrc && (
            <a href={imgSrc} target="_blank" rel="noreferrer" className="mb-img-open-link">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Open full size
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════ STATUS BADGE ══════════════════════════════ */
function StatusBadge({ status }) {
  const s = (status||"").toLowerCase();
  return (
    <span className={`mb-status-badge ${s==="pass"?"pass":s==="fail"?"fail":"unknown"}`}>
      {s==="pass"?"✓":"✗"} {status||"?"}
    </span>
  );
}

/* ══════════════════════════════ PIPELINE BADGE (inscan/log/image sync) ══════════════════════════════ */
function PipelineBadge({ value, retryCount, lastError }) {
  const v = (value || "pending").toLowerCase();
  const cls  = v === "success" ? "pass" : v === "failed" ? "fail" : "unknown";
  const icon = v === "success" ? "✓" : v === "failed" ? "✗" : "…";
  const title = v === "failed" && lastError
    ? `${lastError}${retryCount ? ` (retry ${retryCount})` : ""}`
    : undefined;
  return (
    <span className={`mb-status-badge ${cls}`} title={title}>
      {icon} {v}
    </span>
  );
}

/* ══════════════════════════════ COLUMNS ══════════════════════════════ */
const COLUMNS = [
  { key:"sno",        label:"S.No",      width:"58px",  sortable:false },
  { key:"barcode",    label:"Barcode",   width:"170px", sortable:true  },
  { key:"length",     label:"L (cm)",    width:"72px",  sortable:true  },
  { key:"breadth",    label:"B (cm)",    width:"72px",  sortable:true  },
  { key:"height",     label:"H (cm)",    width:"72px",  sortable:true  },
  { key:"weight",     label:"Wt (g)",    width:"76px",  sortable:true  },
  { key:"Volume",     label:"Volume",    width:"82px",  sortable:true  },
  { key:"RealVolume", label:"Real Vol",  width:"82px",  sortable:true  },
  { key:"status",     label:"Status",    width:"100px", sortable:true  },
  { key:"inscanSent", label:"Inscan",    width:"90px",  sortable:true  },
  { key:"logSent",    label:"Log Sync",  width:"90px",  sortable:true  },
  { key:"imageSent",  label:"Img Sync",  width:"90px",  sortable:true  },
  { key:"dateIST",    label:"Date (IST)",width:"155px", sortable:true  },
  { key:"imagePath",  label:"Image",     width:"80px",  sortable:false },
];

/* ══════════════════════════════ MAIN COMPONENT ══════════════════════════════ */
export default function ManageBins() {
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [badgeText,    setBadgeText]    = useState("Today");
  const [activeFilter, setActiveFilter] = useState(() => {
    const t = getTodayRange();
    return { startIST: t.startIST, endIST: t.endIST };
  });
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [data,         setData]         = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page,         setPage]         = useState(1);
  const [rowsPerPage,  setRowsPerPage]  = useState(25);
  const [loading,      setLoading]      = useState(false);
  const [sortKey,      setSortKey]      = useState("dateIST");
  const [sortDir,      setSortDir]      = useState("desc");

  const [modalRow, setModalRow] = useState(null);

  const [stats, setStats] = useState({ total:0, pass:0, fail:0, rate:"—" });

  /* ── fetch ── */
  const fetchData = useCallback(async (pg=1, rws=rowsPerPage, filter=activeFilter, srch=search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page:pg, limit:rws });
      if (srch.trim()) params.set("search", srch.trim());
      if (filter.startIST && filter.endIST) {
        params.set("startDateTime", filter.startIST);
        params.set("endDateTime",   filter.endIST);
      }
      const res  = await fetch(`${API}/boxdata?${params}`);
      const json = await res.json();
      if (json.success) {
        const d = json.data || [];
        setData(d);
        setTotalRecords(json.totalRecords || 0);
        const pass = d.filter(r=>(r.status||"").toLowerCase()==="pass").length;
        setStats({ total:json.totalRecords, pass, fail:d.length-pass,
          rate: d.length ? (((d.length-pass)/d.length)*100).toFixed(1)+"%" : "—" });
      }
    } catch(err) {
      console.error("ManageBins fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [rowsPerPage, activeFilter, search]);

  /* ── initial load: fresh "Today" range ── */
  useEffect(() => {
    const t = getTodayRange();
    fetchData(1, 25, { startIST: t.startIST, endIST: t.endIST }, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── sidebar apply ── */
  const handleSidebarApply = ({ startIST, endIST, label }) => {
    const f = { startIST, endIST };
    setActiveFilter(f); setBadgeText(label); setSidebarOpen(false); setPage(1);
    fetchData(1, rowsPerPage, f, search);
  };

  /* ── search: clear date filter so barcode is searched across ALL data ── */
  const handleSearch = () => {
    setPage(1);
    if (search.trim()) {
      const noDateFilter = { startIST: null, endIST: null };
      setActiveFilter(noDateFilter);
      setBadgeText("All (search)");
      fetchData(1, rowsPerPage, noDateFilter, search);
    } else {
      fetchData(1, rowsPerPage, activeFilter, search);
    }
  };

  /* ── reset: restore fresh "Today" ── */
  const handleReset = () => {
    setSearch(""); setStatusFilter("all");
    const t = getTodayRange();
    const f = { startIST: t.startIST, endIST: t.endIST };
    setActiveFilter(f);
    setBadgeText("Today");
    setPage(1);
    fetchData(1, rowsPerPage, f, "");
  };

  /* ── pagination ── */
  const totalPages = Math.max(1, Math.ceil(totalRecords / rowsPerPage));

  const handlePageChange = (pg) => {
    const clamped = Math.max(1, Math.min(pg, totalPages));
    setPage(clamped);
    fetchData(clamped, rowsPerPage, activeFilter, search);
  };
  const handleRowsChange = (n) => {
    setRowsPerPage(n); setPage(1);
    fetchData(1, n, activeFilter, search);
  };

  /* ── sort (client-side on current page) ── */
  const handleSort = (key) => {
    const dir = sortKey===key && sortDir==="asc" ? "desc" : "asc";
    setSortKey(key); setSortDir(dir);
  };

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a,b) => {
      let av=a[sortKey]??"", bv=b[sortKey]??"";
      if (!isNaN(av)&&!isNaN(bv)) { av=Number(av); bv=Number(bv); }
      if (av<bv) return sortDir==="asc"?-1:1;
      if (av>bv) return sortDir==="asc"?1:-1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  const filteredData = useMemo(() => {
    if (statusFilter==="all") return sortedData;
    return sortedData.filter(r => {
      const s=(r.status||"").toLowerCase();
      return statusFilter==="pass" ? s==="pass" : s!=="pass";
    });
  }, [sortedData, statusFilter]);

  /* ── export ── */
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (activeFilter.startIST) params.set("startDateTime", activeFilter.startIST);
      if (activeFilter.endIST)   params.set("endDateTime",   activeFilter.endIST);
      const res  = await fetch(`${API}/boxdata/export?${params}`);
      const json = await res.json();
      if (!json.success||!json.data?.length) { alert("No data to export."); return; }
      const rows = json.data.map(r=>({
        Barcode:r.barcode, Length:r.length, Breadth:r.breadth, Height:r.height,
        Weight:r.weight, Volume:r.Volume, RealVolume:r.RealVolume,
        Status:r.status,
        Inscan:r.inscanSent, LogSync:r.logSent, ImageSync:r.imageSent,
        "Date (IST)":fmtIST(r.createdAt), ImagePath:r.imagePath||"",
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "BoxData");
      XLSX.writeFile(wb, `boxdata-${Date.now()}.xlsx`);
    } catch(err) { console.error(err); alert("Export failed."); }
  };

  const handleClear = async () => {
    if (!window.confirm("Delete ALL box data? This cannot be undone.")) return;
    try {
      await fetch(`${API}/boxdata/clear`, { method:"DELETE" }); // was `${API}/clear` — 404'd against the actual route
      setData([]); setTotalRecords(0);
      setStats({total:0,pass:0,fail:0,rate:"—"});
    } catch(err) { console.error(err); alert("Failed."); }
  };

  /* ── page number buttons ── */
  const pageNums = useMemo(() => {
    const nums=[]; const delta=2;
    for (let p=1; p<=totalPages; p++) {
      if (p===1||p===totalPages||(p>=page-delta&&p<=page+delta)) nums.push(p);
      else if (nums[nums.length-1]!=="...") nums.push("...");
    }
    return nums;
  }, [page, totalPages]);

  /* ══════════ RENDER ══════════ */
  return (
    <div className="mb-root">
      {loading && (
        <div className="mb-loader">
          <div className="mb-spinner"/>
          <p className="mb-loader-text">Loading data…</p>
        </div>
      )}

      {sidebarOpen && (
        <FilterSidebar
          onApply={handleSidebarApply}
          onClose={()=>setSidebarOpen(false)}
          initialStart={activeFilter.startIST ? new Date(activeFilter.startIST.replace(" ","T")+"+05:30") : null}
          initialEnd={activeFilter.endIST   ? new Date(activeFilter.endIST.replace(" ","T")+"+05:30")   : null}
        />
      )}

      {modalRow && <ImageModal row={modalRow} onClose={()=>setModalRow(null)}/>}

      {/* ══ TOP BAR ══ */}
      <div className="mb-topbar">
        <div className="mb-brand">
          <span className="mb-brand-dot"/>
          Manage Bins
        </div>
        <div className="mb-sep"/>

        <div className="mb-search-wrap">
          <span className="mb-search-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </span>
          <input className="mb-search" placeholder="Search barcode…"
            value={search} onChange={e=>setSearch(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleSearch()}
          />
        </div>

        <div className="mb-status-group">
          {[{val:"all",label:"All",cls:"sp-all"},{val:"pass",label:"✓ Pass",cls:"sp-pass"},{val:"fail",label:"✗ Reject",cls:"sp-fail"}].map(p=>(
            <button key={p.val}
              className={`mb-status-pill ${p.cls}${statusFilter===p.val?" active":""}`}
              onClick={()=>setStatusFilter(p.val)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="mb-sep"/>

        <span className={`mb-badge${activeFilter.startIST?"":" no-filter"}`}>{badgeText}</span>

        <div className="mb-topbar-right">
          <button className="mb-btn" onClick={handleSearch}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            Query
          </button>
          <button className="mb-btn" onClick={handleReset}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Reset
          </button>
          <button className="mb-btn mb-btn-export" onClick={handleExport}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M5 7l3 3 3-3M3 13h10"/></svg>
            Export
          </button>
          <button className="mb-btn mb-btn-clear" onClick={handleClear}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>
            Clear All
          </button>
          <button className="mb-btn mb-btn-filter" onClick={()=>setSidebarOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
            Date &amp; Time Filter
          </button>
        </div>
      </div>

      {/* ══ BODY ══ */}
      <div className={`mb-body${sidebarOpen?" sidebar-open":""}`}>

        <div className="mb-stats-row">
          {[
            {icon:"📦",label:"Total Records",   val:totalRecords.toLocaleString(),  cls:"blue"  },
            {icon:"✅",label:"Pass (page)",      val:stats.pass.toLocaleString(),    cls:"green" },
            {icon:"⚠️",label:"Fail (page)",      val:stats.fail.toLocaleString(),    cls:"red"   },
            {icon:"📊",label:"Reject % (page)",  val:stats.rate,                     cls:"amber" },
          ].map(s=>(
            <div key={s.cls} className="mb-stat-card">
              <div className={`mb-stat-icon ${s.cls}`}>{s.icon}</div>
              <div>
                <div className="mb-stat-label">{s.label}</div>
                <div className="mb-stat-value">{s.val}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-table-card">
          <div className="mb-table-header">
            <div className="mb-table-title">
              Box Data
              <span className="mb-table-count">{filteredData.length} of {totalRecords.toLocaleString()}</span>
            </div>
            <span className="mb-table-hint">Click any row to view image</span>
          </div>

          <div className="mb-table-scroll">
            {filteredData.length===0 && !loading ? (
              <div className="mb-empty">
                <div className="mb-empty-icon">📭</div>
                <div className="mb-empty-text">No records found — adjust your filters</div>
              </div>
            ) : (
              <table className="mb-table">
                <colgroup>
                  {COLUMNS.map(c=><col key={c.key} style={{width:c.width}}/>)}
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNS.map(c=>{
                      const isActive = sortKey===c.key;
                      return (
                        <th key={c.key}
                          className={`${c.sortable?"sortable":""} ${isActive?"sort-"+sortDir:""}`}
                          onClick={()=>c.sortable&&handleSort(c.key)}>
                          {c.label}
                          {c.sortable&&<span className="sort-icon">{isActive?(sortDir==="asc"?"↑":"↓"):"↕"}</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((row,idx)=>{
                    const hasImg = row.imagePath && row.imagePath !== "image_missing";
                    return (
                      <tr key={row._id?.$oid||row._id||idx}
                        className={modalRow===row?"row-selected":""}
                        onClick={()=>setModalRow(row)}>
                        <td style={{textAlign:"center",color:"var(--mb-text-muted)",fontSize:"11px"}}>
                          {(page-1)*rowsPerPage+idx+1}
                        </td>
                        <td className="mono" title={row.barcode}>{row.barcode}</td>
                        <td>{row.length}</td>
                        <td>{row.breadth}</td>
                        <td>{row.height}</td>
                        <td>{row.weight}</td>
                        <td>{row.Volume}</td>
                        <td>{row.RealVolume}</td>
                        <td><StatusBadge status={row.status}/></td>
                        <td><PipelineBadge value={row.inscanSent} retryCount={row.inscanRetryCount} lastError={row.inscanLastError}/></td>
                        <td><PipelineBadge value={row.logSent}    retryCount={row.logRetryCount}    lastError={row.logLastError}/></td>
                        <td><PipelineBadge value={row.imageSent}  retryCount={row.imageRetryCount}  lastError={row.imageLastError}/></td>
                        <td className="mono">{row.dateIST||fmtIST(row.createdAt)}</td>
                        <td>
                          {hasImg ? (
                            <img
                              src={`http://localhost:5001${row.imagePath}`}
                              alt="thumb"
                              className="mb-img-thumb"
                              onClick={e=>{e.stopPropagation();setModalRow(row);}}
                              onError={e=>{e.target.style.display="none";e.target.nextSibling.style.display="block";}}
                            />
                          ) : null}
                          <span className="mb-img-none" style={{display:hasImg?"none":"block"}}>—</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="mb-pagination">
            <div className="mb-pagination-left">
              <span className="mb-pagination-info">Rows per page:</span>
              <select className="mb-rows-select" value={rowsPerPage}
                onChange={e=>handleRowsChange(Number(e.target.value))}>
                {[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <span className="mb-pagination-info">
                Page {page} of {totalPages} · {totalRecords.toLocaleString()} total
              </span>
            </div>
            <div className="mb-pagination-right">
              <button className="mb-page-btn" disabled={page<=1} onClick={()=>handlePageChange(1)} title="First">«</button>
              <button className="mb-page-btn" disabled={page<=1} onClick={()=>handlePageChange(page-1)} title="Prev">‹</button>
              {pageNums.map((p,i)=>
                p==="..."
                  ? <span key={`el${i}`} style={{padding:"0 3px",color:"var(--mb-text-muted)",fontSize:"12px"}}>…</span>
                  : <button key={p} className={`mb-page-btn${p===page?" active":""}`} onClick={()=>handlePageChange(p)}>{p}</button>
              )}
              <button className="mb-page-btn" disabled={page>=totalPages} onClick={()=>handlePageChange(page+1)} title="Next">›</button>
              <button className="mb-page-btn" disabled={page>=totalPages} onClick={()=>handlePageChange(totalPages)} title="Last">»</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}