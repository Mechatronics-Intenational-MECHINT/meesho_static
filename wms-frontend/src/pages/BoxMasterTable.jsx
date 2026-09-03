import React, { useState, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import "../styles/Boxmaster.css";

const API = "http://localhost:5001/api/boxmaster";

/* ══════════════════════════════ IST UTILS ══════════════════════════════ */
const IST_MS = 5.5 * 3600 * 1000;
const toIST  = (d) => new Date(d.getTime() + IST_MS);
const padZ   = (n) => String(n).padStart(2, "0");
const nowIST = ()  => toIST(new Date());

function startOfISTDay(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0) - IST_MS);
}
function endOfISTDay(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59) - IST_MS);
}
function fmtIST(raw) {
  if (!raw) return "—";

  const d = new Date(raw); // ✅ browser auto converts UTC → IST

  return `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())} ${padZ(d.getHours())}:${padZ(d.getMinutes())}:${padZ(d.getSeconds())}`;
}

/**
 * Route compares processedAt directly with the IST string
 * (filter.processedAt = { $gte: startQ, $lte: endQ } where startQ/endQ = raw string)
 * so we send "YYYY-MM-DD HH:mm:ss" IST strings
 */
function toISTString(date, h, m) {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);

  return `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())} ${padZ(d.getHours())}:${padZ(d.getMinutes())}:00`;
}

const QUICK_OPTIONS = [
  { val:"today",     label:"Today"       },
  { val:"yesterday", label:"Yesterday"   },
  { val:"last2days", label:"Last 2 days" },
  { val:"last7days", label:"Last 7 days" },
];

function getQuickISTStrings(val) {
  const now = new Date();

  let s, e;

  if (val === "today") {
    s = new Date(); s.setHours(0,0,0,0);
    e = new Date();
  } else if (val === "yesterday") {
    s = new Date(); s.setDate(s.getDate()-1); s.setHours(0,0,0,0);
    e = new Date(); e.setDate(e.getDate()-1); e.setHours(23,59,59,999);
  } else if (val === "last2days") {
    s = new Date(); s.setDate(s.getDate()-2); s.setHours(0,0,0,0);
    e = new Date();
  } else if (val === "last7days") {
    s = new Date(); s.setDate(s.getDate()-6); s.setHours(0,0,0,0);
    e = new Date();
  }

  const fmt = (d) =>
    `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())} ${padZ(d.getHours())}:${padZ(d.getMinutes())}:${padZ(d.getSeconds())}`;

  return { start: fmt(s), end: fmt(e), label: val };
}

function getTodayFilter() {
  return getQuickISTStrings("today");
}
const TODAY_FILTER = getTodayFilter();

/* ══════════════════════════════ STATUS OPTIONS ══════════════════════════════ */
const STATUS_OPTIONS = [
  { value:"",               label:"All Status"       },
  { value:"success",        label:"✓ Success"        },
  { value:"gi_sent",        label:"GI Sent"          },
  { value:"gi_not_sent",    label:"GI Not Sent"      },
  { value:"dws_sent",       label:"DWS Sent"         },
  { value:"dws_not_sent",   label:"DWS Not Sent"     },
  { value:"image_sent",     label:"Image Sent"       },
  { value:"image_not_sent", label:"Image Not Sent"   },
];

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
    <div className="bm-cal-block">
      <div className="bm-sb-section-label">
        <span style={{color:accentColor,fontSize:"10px"}}>●</span> {label}
      </div>
      <div className="bm-cal-with-time">
        <div className="bm-cal-wrapper">
          <div className="bm-cal-header">
            <button className="bm-cal-nav" onClick={prevM}>‹</button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button className="bm-cal-nav" onClick={nextM}>›</button>
          </div>
          <div className="bm-cal-grid">
            <div className="bm-cal-dow">{DOW.map(d=><span key={d}>{d}</span>)}</div>
            <div className="bm-cal-days">
              {cells.map((day,i) => {
                if (!day) return <span key={`e${i}`} className="bm-cal-day empty"/>;
                const isToday = day.toDateString()===today.toDateString();
                const isSel   = selected && day.toDateString()===selected.toDateString();
                const inRange = rangeStart&&rangeEnd&&day>rangeStart&&day<rangeEnd;
                let cls="bm-cal-day";
                if(isToday) cls+=" today";
                if(isSel)   cls+=" selected";
                else if(inRange) cls+=" in-range";
                return <button key={i} className={cls} onClick={()=>onSelect(day)}>{day.getDate()}</button>;
              })}
            </div>
          </div>
        </div>
        <div className="bm-time-panel">
          <div className="bm-time-panel-head">TIME</div>
          <div className="bm-time-panel-sub">IST · 24H</div>
          <div className="bm-time-spin">
            <button className="bm-time-spin-btn" onClick={()=>onHoursChange(spin(hours,23,1))}>▲</button>
            <div className="bm-time-display" style={{borderColor:accentColor,color:accentColor}}>{padZ(hours)}</div>
            <button className="bm-time-spin-btn" onClick={()=>onHoursChange(spin(hours,23,-1))}>▼</button>
          </div>
          <div className="bm-time-colon">:</div>
          <div className="bm-time-spin">
            <button className="bm-time-spin-btn" onClick={()=>onMinutesChange(spin(minutes,59,1))}>▲</button>
            <div className="bm-time-display" style={{borderColor:accentColor,color:accentColor}}>{padZ(minutes)}</div>
            <button className="bm-time-spin-btn" onClick={()=>onMinutesChange(spin(minutes,59,-1))}>▼</button>
          </div>
          <div className="bm-time-selected-box" style={{borderColor:accentColor}}>
            <span className="bm-time-selected-date">
              {selected?`${padZ(selected.getDate())}/${padZ(selected.getMonth()+1)}`:"--/--"}
            </span>
            <span className="bm-time-selected-time" style={{color:accentColor}}>
              {padZ(hours)}:{padZ(minutes)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════ FILTER SIDEBAR ══════════════════════════════ */
function FilterSidebar({ onApply, onClose }) {
  const [tab, setTab]             = useState("quick");
  const [activeQuick, setActiveQuick] = useState("today");
  const todayIST = nowIST();
  const [startDate,setStartDate]  = useState(todayIST);
  const [startH,   setStartH]     = useState(0);
  const [startM,   setStartM]     = useState(0);
  const [endDate,  setEndDate]    = useState(todayIST);
  const [endH,     setEndH]       = useState(23);
  const [endM,     setEndM]       = useState(59);

  const durMs = useMemo(() => {
    const s = new Date(startDate.getFullYear(),startDate.getMonth(),startDate.getDate(),startH,startM,0);
    const e = new Date(endDate.getFullYear(),endDate.getMonth(),endDate.getDate(),endH,endM,0);
    return e - s;
  },[startDate,startH,startM,endDate,endH,endM]);

  const durStr = useMemo(()=>{
    if(durMs<=0) return "Invalid range";
    const h=Math.floor(durMs/3600000), m=Math.floor((durMs%3600000)/60000);
    return `${h}h ${padZ(m)}m`;
  },[durMs]);

  const handleQuickApply = (val) => {
    setActiveQuick(val);
    const f = getQuickISTStrings(val);
    if (!f) return;
    onApply(f);
  };

  const handleCustomApply = () => {
    if (durMs<=0) { alert("End must be after start."); return; }
    onApply({
      start: toISTString(startDate,startH,startM),
      end:   toISTString(endDate,endH,endM),
      label: `${padZ(startDate.getDate())}/${padZ(startDate.getMonth()+1)} ${padZ(startH)}:${padZ(startM)} → ${padZ(endDate.getDate())}/${padZ(endDate.getMonth()+1)} ${padZ(endH)}:${padZ(endM)} IST`,
    });
  };

  return (
    <>
      <div className="bm-sidebar-overlay" onClick={onClose}/>
      <div className="bm-sidebar">
        <div className="bm-sb-header">
          <div className="bm-sb-title">
            <div className="bm-sb-title-icon">
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
          <button className="bm-sb-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="bm-sb-tabs">
          <button className={`bm-sb-tab${tab==="quick"?" active":""}`} onClick={()=>setTab("quick")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            Quick
          </button>
          <button className={`bm-sb-tab${tab==="custom"?" active":""}`} onClick={()=>setTab("custom")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            Custom
          </button>
        </div>
        <div className="bm-sb-body">
          {tab==="quick" ? (
            <>
              <div className="bm-sb-section-label" style={{marginTop:0}}>Select range</div>
              <div className="bm-quick-grid">
                {QUICK_OPTIONS.map(o=>(
                  <button key={o.val} className={`bm-quick-btn${activeQuick===o.val?" active":""}`}
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
              <div className={`bm-duration${durMs<=0?" warn":""}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke={durMs>0?"#15803d":"#c2410c"} strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
                <span>Duration: {durStr}</span>
              </div>
              <button className="bm-sb-apply" onClick={handleCustomApply}>Apply Range</button>
            </>
          )}
        </div>
        {tab==="quick" && (
          <div className="bm-sb-footer">
            <button className="bm-sb-cancel" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════ STATUS BADGE ══════════════════════════════ */
function StatusBadge({ value }) {
  if (!value) return <span className="bm-badge-na">—</span>;
  const v = String(value).toLowerCase().trim();
  if (v === "sent")     return <span className="bm-badge-sent">✓ sent</span>;
  if (v === "not sent") return <span className="bm-badge-notsent">✗ not sent</span>;
  return <span className="bm-badge-na">{value}</span>;
}

/* ══════════════════════════════ COLUMNS ══════════════════════════════ */
const COLUMNS = [
  { key:"sno",           label:"S.No",         width:"55px",  sortable:false },
  { key:"barcode",       label:"Barcode",       width:"170px", sortable:true  },
  { key:"length",        label:"Length",        width:"72px",  sortable:true  },
  { key:"breadth",       label:"Breadth",       width:"72px",  sortable:true  },
  { key:"height",        label:"Height",        width:"72px",  sortable:true  },
  { key:"weight",        label:"Weight",        width:"72px",  sortable:true  },
  { key:"volume",        label:"Volume",        width:"80px",  sortable:true  },
  { key:"realVolume",    label:"Real Vol",      width:"80px",  sortable:true  },
  { key:"giStatus",      label:"GI Status",     width:"100px", sortable:true  },
  { key:"giResponse",    label:"GI Response",   width:"140px", sortable:false },
  { key:"weightStatus",  label:"Wt Status",     width:"100px", sortable:true  },
  { key:"weightResponse",label:"Wt Response",   width:"160px", sortable:false },
  { key:"s3Status",      label:"S3 Status",     width:"100px", sortable:true  },
  { key:"s3Path",        label:"S3 Path",       width:"180px", sortable:false },
  { key:"createdAt",   label:"createdAt",  width:"155px", sortable:true  },
];

/* ══════════════════════════════ MAIN COMPONENT ══════════════════════════════ */
export default function BoxMasterTable() {
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [badgeText,    setBadgeText]    = useState(TODAY_FILTER.label);
  const [activeFilter, setActiveFilter] = useState({ start:TODAY_FILTER.start, end:TODAY_FILTER.end });
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [data,         setData]         = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page,         setPage]         = useState(1);
  const [rowsPerPage,  setRowsPerPage]  = useState(25);
  const [loading,      setLoading]      = useState(false);
  const [sortKey,      setSortKey]      = useState("createdAt");
  const [sortDir,      setSortDir]      = useState("desc");

  /* ── fetch ── */
  const fetchData = useCallback(async (pg, rws, filter, srch, status) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page:pg, limit:rws });
      if ((srch||"").trim()) params.set("search", srch.trim());
      if (filter?.start && filter?.end) {
        params.set("start", filter.start);
        params.set("end",   filter.end);
      }
      if (status) params.set("status", status);
      const res  = await fetch(`${API}?${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data || []);
        setTotalRecords(json.total || 0);
      }
    } catch(err) {
      console.error("BoxMaster fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(1, 25, { start:TODAY_FILTER.start, end:TODAY_FILTER.end }, "", "");
  }, []); // eslint-disable-line

  const handleSidebarApply = ({ start, end, label }) => {
    const f = { start, end };
    setActiveFilter(f); setBadgeText(label); setSidebarOpen(false); setPage(1);
    fetchData(1, rowsPerPage, f, search, statusFilter);
  };

  const handleSearch = () => {
    setPage(1);
    fetchData(1, rowsPerPage, activeFilter, search, statusFilter);
  };

  const handleStatusChange = (val) => {
    setStatusFilter(val); setPage(1);
    fetchData(1, rowsPerPage, activeFilter, search, val);
  };

const handleReset = () => {
  setSearch("");
  setStatusFilter("");

  // Remove active filter
  setActiveFilter({});
  setBadgeText("All Data");

  setPage(1);

  fetchData(1, rowsPerPage, {}, "", "");
};

  /* ── pagination ── */
  const totalPages = Math.max(1, Math.ceil(totalRecords / rowsPerPage));
  const handlePageChange = (pg) => {
    const p = Math.max(1, Math.min(pg, totalPages));
    setPage(p); fetchData(p, rowsPerPage, activeFilter, search, statusFilter);
  };
  const handleRowsChange = (n) => {
    setRowsPerPage(n); setPage(1); fetchData(1, n, activeFilter, search, statusFilter);
  };

  /* ── sort (client-side) ── */
  const handleSort = (key) => {
    const dir = sortKey===key && sortDir==="asc" ? "desc" : "asc";
    setSortKey(key); setSortDir(dir);
  };

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a,b)=>{
      let av=a[sortKey]??"", bv=b[sortKey]??"";
      if (!isNaN(av)&&!isNaN(bv)) { av=Number(av); bv=Number(bv); }
      if(av<bv) return sortDir==="asc"?-1:1;
      if(av>bv) return sortDir==="asc"?1:-1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  /* ── export ── */
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (activeFilter.start) params.set("start", activeFilter.start);
      if (activeFilter.end)   params.set("end",   activeFilter.end);
      if (statusFilter)       params.set("status", statusFilter);
      const res  = await fetch(`${API}/export?${params}`);
      const json = await res.json();
      if (!json.success||!json.data?.length) { alert("No data to export."); return; }
      const rows = json.data.map(r=>({
        Barcode:r.barcode, Length:r.length, Breadth:r.breadth,
        Height:r.height, Weight:r.weight, Volume:r.volume, RealVolume:r.realVolume,
        GI_Status:r.giStatus, GI_Response:r.giResponse,
        Weight_Status:r.weightStatus, Weight_Response:r.weightResponse,
        S3_Status:r.s3Status, S3_Path:r.s3Path,
        Processed_At:r.processedAt,
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "BoxMaster");
      XLSX.writeFile(wb, `boxmaster-${Date.now()}.xlsx`);
    } catch(err) { console.error(err); alert("Export failed."); }
  };

  const handleClear = async () => {
    if (!window.confirm("Delete ALL BoxMaster records? This cannot be undone.")) return;
    try {
      await fetch(API, { method:"DELETE" });
      setData([]); setTotalRecords(0);
    } catch(err) { console.error(err); alert("Failed."); }
  };

  const pageNums = useMemo(()=>{
    const nums=[]; const delta=2;
    for(let p=1;p<=totalPages;p++){
      if(p===1||p===totalPages||(p>=page-delta&&p<=page+delta)) nums.push(p);
      else if(nums[nums.length-1]!=="...") nums.push("...");
    }
    return nums;
  },[page,totalPages]);

  /* ══════════════════════════════ RENDER ══════════════════════════════ */
  return (
    <div className="bm-root">
      {loading && (
        <div className="bm-loader">
          <div className="bm-spinner"/>
          <p className="bm-loader-text">Loading BoxMaster data…</p>
        </div>
      )}

      {sidebarOpen && (
        <FilterSidebar
          onApply={handleSidebarApply}
          onClose={()=>setSidebarOpen(false)}
        />
      )}

      {/* ══ TOP BAR ══ */}
      <div className="bm-topbar">
        <div className="bm-brand">
          <span className="bm-brand-dot"/>
          Box Master
        </div>
        <div className="bm-sep"/>

        {/* Search */}
        <div className="bm-search-wrap">
          <span className="bm-search-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </span>
          <input className="bm-search" placeholder="Search barcode…"
            value={search} onChange={e=>setSearch(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleSearch()}
          />
        </div>

        {/* Status dropdown */}
        <select
          className="bm-status-select"
          value={statusFilter}
          onChange={e=>handleStatusChange(e.target.value)}
        >
          {STATUS_OPTIONS.map(o=>(
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <div className="bm-sep"/>
        <span className={`bm-badge${activeFilter.start?"":" no-filter"}`}>{badgeText}</span>

        <div className="bm-topbar-right">
          <button className="bm-btn" onClick={handleSearch}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            Query
          </button>
          <button className="bm-btn" onClick={handleReset}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Reset
          </button>
          <button className="bm-btn bm-btn-export" onClick={handleExport}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M5 7l3 3 3-3M3 13h10"/></svg>
            Export
          </button>
          <button className="bm-btn bm-btn-clear" onClick={handleClear}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>
            Clear All
          </button>
          <button className="bm-btn bm-btn-filter" onClick={()=>setSidebarOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
            Date &amp; Time Filter
          </button>
        </div>
      </div>

      {/* ══ BODY — table only ══ */}
      <div className={`bm-body${sidebarOpen?" sidebar-open":""}`}>
        <div className="bm-table-card">
          <div className="bm-table-header">
            <div className="bm-table-title">
              Box Master Records
              <span className="bm-table-count">{sortedData.length} of {totalRecords.toLocaleString()}</span>
            </div>
            <span style={{fontSize:"11px",color:"var(--bm-text-muted)"}}>
              Showing: <strong style={{color:"var(--bm-accent)"}}>{badgeText}</strong>
              {statusFilter && <span style={{marginLeft:8,color:"var(--bm-purple)",fontWeight:600}}>
                · {STATUS_OPTIONS.find(o=>o.value===statusFilter)?.label}
              </span>}
            </span>
          </div>

          <div className="bm-table-scroll">
            {sortedData.length===0 && !loading ? (
              <div className="bm-empty">
                <div className="bm-empty-icon">📦</div>
                <div className="bm-empty-text">No records found — adjust your filters</div>
              </div>
            ) : (
              <table className="bm-table">
                <colgroup>
                  {COLUMNS.map(c=><col key={c.key} style={{width:c.width}}/>)}
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNS.map(c=>{
                      const isActive=sortKey===c.key;
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
                  {sortedData.map((row,idx)=>(
                    <tr key={row._id?.$oid||row._id||idx}>
                      <td style={{textAlign:"center",color:"var(--bm-text-muted)",fontSize:"11px"}}>
                        {(page-1)*rowsPerPage+idx+1}
                      </td>
                      <td className="mono" title={row.barcode}>{row.barcode}</td>
                      <td>{row.length}</td>
                      <td>{row.breadth}</td>
                      <td>{row.height}</td>
                      <td>{row.weight}</td>
                      <td>{row.volume}</td>
                      <td>{row.realVolume}</td>
                      <td><StatusBadge value={row.giStatus}/></td>
                      <td className="wrap" title={row.giResponse}>{row.giResponse ?? "—"}</td>
                      <td><StatusBadge value={row.weightStatus}/></td>
                      <td className="wrap" title={row.weightResponse}>{row.weightResponse ?? "—"}</td>
                      <td><StatusBadge value={row.s3Status}/></td>
                      <td className="wrap" title={row.s3Path}>{row.s3Path||"—"}</td>
                      <td className="mono">{fmtIST(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          <div className="bm-pagination">
            <div className="bm-pagination-left">
              <span className="bm-pagination-info">Rows per page:</span>
              <select className="bm-rows-select" value={rowsPerPage}
                onChange={e=>handleRowsChange(Number(e.target.value))}>
                {[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <span className="bm-pagination-info">
                Page {page} of {totalPages} · {totalRecords.toLocaleString()} total
              </span>
            </div>
            <div className="bm-pagination-right">
              <button className="bm-page-btn" disabled={page<=1} onClick={()=>handlePageChange(1)}>«</button>
              <button className="bm-page-btn" disabled={page<=1} onClick={()=>handlePageChange(page-1)}>‹</button>
              {pageNums.map((p,i)=>
                p==="..."
                  ? <span key={`el${i}`} style={{padding:"0 3px",color:"var(--bm-text-muted)",fontSize:"12px"}}>…</span>
                  : <button key={p} className={`bm-page-btn${p===page?" active":""}`} onClick={()=>handlePageChange(p)}>{p}</button>
              )}
              <button className="bm-page-btn" disabled={page>=totalPages} onClick={()=>handlePageChange(page+1)}>›</button>
              <button className="bm-page-btn" disabled={page>=totalPages} onClick={()=>handlePageChange(totalPages)}>»</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}