import React, { useState, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import "../styles/AlertLogs.css";

const API_LOGS   = "http://localhost:5001/api/alarms/alert-logs";

/* ══════════════════════════════ IST UTILS ══════════════════════════════ */
const padZ = (n) => String(n).padStart(2, "0");
const nowIST = () => new Date();
const IST_MS = 5.5 * 3600 * 1000;
function startOfISTDay(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0) - IST_MS);
}
function endOfISTDay(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59) - IST_MS);
}

// ✅ FIXED: use UTC getters after shifting to IST
function fmtIST(raw) {
  if (!raw) return "—";

  return new Date(raw).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatMs(ms) {
  if (!ms || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h}h ${rm}m`;
}

/** Backend /alert-logs expects IST string "YYYY-MM-DD HH:mm:ss" */
function toISTString(date, h, m) {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);

  return `${d.getFullYear()}-${padZ(d.getMonth() + 1)}-${padZ(d.getDate())} ${padZ(d.getHours())}:${padZ(d.getMinutes())}:${padZ(d.getSeconds())}`;
}

const QUICK_OPTIONS = [
  { val:"today",     label:"Today"       },
  { val:"yesterday", label:"Yesterday"   },
  { val:"last2days", label:"Last 2 days" },
  { val:"last7days", label:"Last 7 days" },
];

function getQuickRange(val) {
  const now = new Date();

  let s = new Date(now);
  let e = new Date(now);

  switch (val) {
    case "today":
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
      break;

    case "yesterday":
      s.setDate(s.getDate() - 1);
      e.setDate(e.getDate() - 1);
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
      break;

    case "last2days":
      s.setDate(s.getDate() - 1);
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
      break;

    case "last7days":
      s.setDate(s.getDate() - 6);
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
      break;

    default:
      return null;
  }

  return { s, e };
}

function getQuickISTStrings(val) {
  const r = getQuickRange(val);
  if (!r) return null;

  const fmt = (d) =>
    `${d.getFullYear()}-${padZ(d.getMonth() + 1)}-${padZ(d.getDate())} ${padZ(d.getHours())}:${padZ(d.getMinutes())}:${padZ(d.getSeconds())}`;

  return {
    start: fmt(r.s),
    end: fmt(r.e),
    label: QUICK_OPTIONS.find((o) => o.val === val)?.label || val,
  };
}

// ✅ FIXED: no stale module-level constant
function getTodayFilter() {
  return getQuickISTStrings("today");
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
    <div className="alg-cal-block">
      <div className="alg-sb-section-label">
        <span style={{color:accentColor,fontSize:"10px"}}>●</span> {label}
      </div>
      <div className="alg-cal-with-time">
        <div className="alg-cal-wrapper">
          <div className="alg-cal-header">
            <button className="alg-cal-nav" onClick={prevM}>‹</button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button className="alg-cal-nav" onClick={nextM}>›</button>
          </div>
          <div className="alg-cal-grid">
            <div className="alg-cal-dow">{DOW.map(d=><span key={d}>{d}</span>)}</div>
            <div className="alg-cal-days">
              {cells.map((day,i) => {
                if (!day) return <span key={`e${i}`} className="alg-cal-day empty"/>;
                const isToday = day.toDateString()===today.toDateString();
                const isSel   = selected && day.toDateString()===selected.toDateString();
                const inRange = rangeStart&&rangeEnd&&day>rangeStart&&day<rangeEnd;
                let cls="alg-cal-day";
                if(isToday) cls+=" today";
                if(isSel)   cls+=" selected";
                else if(inRange) cls+=" in-range";
                return <button key={i} className={cls} onClick={()=>onSelect(day)}>{day.getDate()}</button>;
              })}
            </div>
          </div>
        </div>
        <div className="alg-time-panel">
          <div className="alg-time-panel-head">TIME</div>
          <div className="alg-time-panel-sub">IST · 24H</div>
          <div className="alg-time-spin">
            <button className="alg-time-spin-btn" onClick={()=>onHoursChange(spin(hours,23,1))}>▲</button>
            <div className="alg-time-display" style={{borderColor:accentColor,color:accentColor}}>{padZ(hours)}</div>
            <button className="alg-time-spin-btn" onClick={()=>onHoursChange(spin(hours,23,-1))}>▼</button>
          </div>
          <div className="alg-time-colon">:</div>
          <div className="alg-time-spin">
            <button className="alg-time-spin-btn" onClick={()=>onMinutesChange(spin(minutes,59,1))}>▲</button>
            <div className="alg-time-display" style={{borderColor:accentColor,color:accentColor}}>{padZ(minutes)}</div>
            <button className="alg-time-spin-btn" onClick={()=>onMinutesChange(spin(minutes,59,-1))}>▼</button>
          </div>
          <div className="alg-time-selected-box" style={{borderColor:accentColor}}>
            <span className="alg-time-selected-date">
              {selected?`${padZ(selected.getDate())}/${padZ(selected.getMonth()+1)}`:"--/--"}
            </span>
            <span className="alg-time-selected-time" style={{color:accentColor}}>
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
    onApply({ start:f.start, end:f.end, label:f.label });
  };

  const handleCustomApply = () => {
    if (durMs<=0) { alert("End must be after start."); return; }
    const start = toISTString(startDate,startH,startM);
    const end   = toISTString(endDate,endH,endM);
    const label = `${padZ(startDate.getDate())}/${padZ(startDate.getMonth()+1)} ${padZ(startH)}:${padZ(startM)} → ${padZ(endDate.getDate())}/${padZ(endDate.getMonth()+1)} ${padZ(endH)}:${padZ(endM)} IST`;
    onApply({ start, end, label });
  };

  return (
    <>
      <div className="alg-sidebar-overlay" onClick={onClose}/>
      <div className="alg-sidebar">
        <div className="alg-sb-header">
          <div className="alg-sb-title">
            <div className="alg-sb-title-icon">
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
          <button className="alg-sb-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="alg-sb-tabs">
          <button className={`alg-sb-tab${tab==="quick"?" active":""}`} onClick={()=>setTab("quick")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            Quick
          </button>
          <button className={`alg-sb-tab${tab==="custom"?" active":""}`} onClick={()=>setTab("custom")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            Custom
          </button>
        </div>
        <div className="alg-sb-body">
          {tab==="quick" ? (
            <>
              <div className="alg-sb-section-label" style={{marginTop:0}}>Select range</div>
              <div className="alg-quick-grid">
                {QUICK_OPTIONS.map(o=>(
                  <button key={o.val} className={`alg-quick-btn${activeQuick===o.val?" active":""}`}
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
              <div className={`alg-duration${durMs<=0?" warn":""}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke={durMs>0?"#15803d":"#c2410c"} strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
                <span>Duration: {durStr}</span>
              </div>
              <button className="alg-sb-apply" onClick={handleCustomApply}>Apply Range</button>
            </>
          )}
        </div>
        {tab==="quick" && (
          <div className="alg-sb-footer">
            <button className="alg-sb-cancel" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════ COLUMNS ══════════════════════════════ */
const COLUMNS = [
  { key:"sno",            label:"S.No",           width:"55px",  sortable:false },
  { key:"code",           label:"Code",           width:"80px",  sortable:true  },
  { key:"message",        label:"Alarm Name",     width:"220px", sortable:true  },
  { key:"cause",          label:"Cause",          width:"220px", sortable:false },
  { key:"count",          label:"Occurrences",    width:"100px", sortable:true  },
  { key:"activeCount",    label:"Active",         width:"80px",  sortable:true  },
  { key:"resolvedCount",  label:"Resolved",       width:"80px",  sortable:true  },
  { key:"avgDurationMs",  label:"Avg Duration",   width:"110px", sortable:true  },
  { key:"totalDurationMs",label:"Total Duration", width:"110px", sortable:true  },
  { key:"lastSeen",       label:"Last Seen (IST)",width:"155px", sortable:true  },
  { key:"firstSeen",      label:"First Seen (IST)",width:"155px",sortable:true  },
];

/* ══════════════════════════════ MAIN COMPONENT ══════════════════════════════ */
export default function AlertLogs() {
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [badgeText,    setBadgeText]    = useState("Today");
  const [activeFilter, setActiveFilter] = useState(null); // ✅ start null, set on mount
  const [search, setSearch] = useState("");

  const [data,         setData]         = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page,         setPage]         = useState(1);
  const [rowsPerPage,  setRowsPerPage]  = useState(25);
  const [loading,      setLoading]      = useState(false);
  const [sortKey,      setSortKey]      = useState("count");
  const [sortDir,      setSortDir]      = useState("desc");

  /* ── fetch — sends IST strings as route expects ── */
  const fetchData = useCallback(async (pg, rws, filter, srch) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page:pg, limit:rws });
      if ((srch||"").trim()) params.set("search", srch.trim());
      if (filter?.start && filter?.end) {
        params.set("start", filter.start);
        params.set("end",   filter.end);
      }
      const res  = await fetch(`${API_LOGS}?${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data || []);
        setTotalRecords(json.total || 0);
      }
    } catch(err) {
      console.error("AlertLogs fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ FIXED: compute fresh today filter on mount
  useEffect(() => {
    const f = getTodayFilter();
    setActiveFilter({ start: f.start, end: f.end });
    setBadgeText(f.label);
    fetchData(1, 25, { start: f.start, end: f.end }, "");
  }, [fetchData]);

  const handleSidebarApply = ({ start, end, label }) => {
    const f = { start, end };
    setActiveFilter(f); setBadgeText(label); setSidebarOpen(false); setPage(1);
    fetchData(1, rowsPerPage, f, search);
  };

  const handleSearch = () => { setPage(1); fetchData(1, rowsPerPage, activeFilter, search); };

  const handleReset = () => {
    const f = getTodayFilter();
    setSearch("");
    setActiveFilter({ start:f.start, end:f.end });
    setBadgeText(f.label); setPage(1);
    fetchData(1, rowsPerPage, { start:f.start, end:f.end }, "");
  };

  /* ── pagination ── */
  const totalPages = Math.max(1, Math.ceil(totalRecords / rowsPerPage));
  const handlePageChange = (pg) => {
    const p = Math.max(1, Math.min(pg, totalPages));
    setPage(p); fetchData(p, rowsPerPage, activeFilter, search);
  };
  const handleRowsChange = (n) => {
    setRowsPerPage(n); setPage(1); fetchData(1, n, activeFilter, search);
  };

  /* ── sort ── */
  const handleSort = (key) => {
    const dir = sortKey===key && sortDir==="asc" ? "desc" : "asc";
    setSortKey(key); setSortDir(dir);
  };

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a,b)=>{
      let av=a[sortKey]??"", bv=b[sortKey]??"";
      if(sortKey==="lastSeen"||sortKey==="firstSeen") { av=new Date(av||0); bv=new Date(bv||0); }
      else if(typeof av==="number"||typeof bv==="number") { av=Number(av)||0; bv=Number(bv)||0; }
      if(av<bv) return sortDir==="asc"?-1:1;
      if(av>bv) return sortDir==="asc"?1:-1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  /* ── export — fetches all aggregated data (no pagination) ── */
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (activeFilter?.start) params.set("start", activeFilter.start);
      if (activeFilter?.end)   params.set("end",   activeFilter.end);
      const res  = await fetch(`${API_LOGS}/export?${params}`);
      const json = await res.json();
      if (!json.success||!json.data?.length) { alert("No data to export."); return; }
      const rows = json.data.map(r=>({
        Code: r.code,
        "Alarm Name": r.message,
        Cause: r.cause || "",
        Occurrences: r.count,
        Active: r.activeCount,
        Resolved: r.resolvedCount,
        "Avg Duration": formatMs(r.avgDurationMs),
        "Total Duration": formatMs(r.totalDurationMs),
        "Last Seen (IST)": fmtIST(r.lastSeen),
        "First Seen (IST)": fmtIST(r.firstSeen),
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "AlertLogs");
      XLSX.writeFile(wb, `alert-logs-${Date.now()}.xlsx`);
    } catch(err) { console.error(err); alert("Export failed."); }
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
    <div className="alg-root">
      {loading && (
        <div className="alg-loader">
          <div className="alg-spinner"/>
          <p className="alg-loader-text">Loading alert logs…</p>
        </div>
      )}

      {sidebarOpen && (
        <FilterSidebar
          onApply={handleSidebarApply}
          onClose={()=>setSidebarOpen(false)}
        />
      )}

      {/* ══ TOP BAR ══ */}
      <div className="alg-topbar">
        <div className="alg-brand">
          <span className="alg-brand-dot"/>
          Alert Logs
        </div>
        <div className="alg-sep"/>

        <div className="alg-search-wrap">
          <span className="alg-search-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </span>
          <input className="alg-search" placeholder="Search alarm code…"
            value={search} onChange={e=>setSearch(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleSearch()}
          />
        </div>

        <div className="alg-sep"/>
        <span className={`alg-badge${activeFilter?.start?"":" no-filter"}`}>{badgeText}</span>

        <div className="alg-topbar-right">
          <button className="alg-btn" onClick={handleSearch}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            Query
          </button>
          <button className="alg-btn" onClick={handleReset}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Reset
          </button>
          <button className="alg-btn alg-btn-export" onClick={handleExport}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M5 7l3 3 3-3M3 13h10"/></svg>
            Export
          </button>
          <button className="alg-btn alg-btn-filter" onClick={()=>setSidebarOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
            Date &amp; Time Filter
          </button>
        </div>
      </div>

      {/* ══ BODY ══ */}
      <div className={`alg-body${sidebarOpen?" sidebar-open":""}`}>
        <div className="alg-table-card">
          <div className="alg-table-header">
            <div className="alg-table-title">
              Alarm Frequency
              <span className="alg-table-count">{sortedData.length} of {totalRecords.toLocaleString()}</span>
            </div>
            <span style={{fontSize:"11px",color:"var(--alg-text-muted)"}}>
              Showing: <strong style={{color:"var(--alg-accent)"}}>{badgeText}</strong> · sorted by highest count
            </span>
          </div>

          <div className="alg-table-scroll">
            {sortedData.length===0 && !loading ? (
              <div className="alg-empty">
                <div className="alg-empty-icon">📋</div>
                <div className="alg-empty-text">No alert logs found — adjust your filters</div>
              </div>
            ) : (
              <table className="alg-table">
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
                    <tr key={`${row.code}-${row.message}-${idx}`}>
                      <td style={{textAlign:"center",color:"var(--alg-text-muted)",fontSize:"11px"}}>
                        {(page-1)*rowsPerPage+idx+1}
                      </td>
                      <td className="mono" style={{fontWeight:600}}>{row.code}</td>
                      <td className="wrap" title={row.message}>{row.message||"—"}</td>
                      <td className="wrap" title={row.cause} style={{color:"var(--alg-text-sec)",fontSize:"11.5px"}}>{row.cause||"—"}</td>
                      <td style={{textAlign:"center"}}>
                        <span className="alg-count-badge">{row.count}</span>
                      </td>
                      <td style={{textAlign:"center"}}>
                        {row.activeCount > 0
                          ? <span className="alg-active-badge">{row.activeCount}</span>
                          : <span style={{color:"var(--alg-text-muted)"}}>0</span>
                        }
                      </td>
                      <td style={{textAlign:"center"}}>
                        {row.resolvedCount > 0
                          ? <span className="alg-resolved-badge">{row.resolvedCount}</span>
                          : <span style={{color:"var(--alg-text-muted)"}}>0</span>
                        }
                      </td>
                      <td className="mono" style={{fontSize:"11.5px"}}>{formatMs(row.avgDurationMs)}</td>
                      <td className="mono" style={{fontSize:"11.5px"}}>{formatMs(row.totalDurationMs)}</td>
                      <td className="mono">{fmtIST(row.lastSeen)}</td>
                      <td className="mono">{fmtIST(row.firstSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          <div className="alg-pagination">
            <div className="alg-pagination-left">
              <span className="alg-pagination-info">Rows per page:</span>
              <select className="alg-rows-select" value={rowsPerPage}
                onChange={e=>handleRowsChange(Number(e.target.value))}>
                {[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <span className="alg-pagination-info">
                Page {page} of {totalPages} · {totalRecords.toLocaleString()} total
              </span>
            </div>
            <div className="alg-pagination-right">
              <button className="alg-page-btn" disabled={page<=1} onClick={()=>handlePageChange(1)}>«</button>
              <button className="alg-page-btn" disabled={page<=1} onClick={()=>handlePageChange(page-1)}>‹</button>
              {pageNums.map((p,i)=>
                p==="..."
                  ? <span key={`el${i}`} style={{padding:"0 3px",color:"var(--alg-text-muted)",fontSize:"12px"}}>…</span>
                  : <button key={p} className={`alg-page-btn${p===page?" active":""}`} onClick={()=>handlePageChange(p)}>{p}</button>
              )}
              <button className="alg-page-btn" disabled={page>=totalPages} onClick={()=>handlePageChange(page+1)}>›</button>
              <button className="alg-page-btn" disabled={page>=totalPages} onClick={()=>handlePageChange(totalPages)}>»</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}