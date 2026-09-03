import React, { useState, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import "../styles/Alarms.css";

const API = "http://localhost:5001/api/alarms";

/* ══════════════════════════════ IST UTILS ══════════════════════════════ */
const IST_MS = 5.5 * 3600 * 1000;
const toIST  = (d) => new Date(d.getTime() + IST_MS);
const padZ   = (n) => String(n).padStart(2, "0");
const nowIST = ()  => toIST(new Date());

function startOfISTDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0,0,0) - IST_MS);
}
function endOfISTDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23,59,59) - IST_MS);
}
function fmtIST(raw) {
  if (!raw) return "—";
  const d = toIST(new Date(raw));
  return `${d.getUTCFullYear()}-${padZ(d.getUTCMonth()+1)}-${padZ(d.getUTCDate())} ${padZ(d.getUTCHours())}:${padZ(d.getUTCMinutes())}:${padZ(d.getUTCSeconds())}`;
}
// Duration between two timestamps in human form
function durationStr(arrivedAt, resolvedAt) {
  if (!arrivedAt || !resolvedAt) return null;
  const ms = new Date(resolvedAt) - new Date(arrivedAt);
  if (ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h}h ${rm}m`;
}
function buildUTCFromParts(date, h, m) {
  const midnightUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const midnightIST = midnightUTC - IST_MS;
  return new Date(midnightIST + (h * 3600 + m * 60) * 1000).toISOString();
}

const QUICK_OPTIONS = [
  { val:"today",     label:"Today"      },
  { val:"yesterday", label:"Yesterday"  },
  { val:"last2days", label:"Last 2 days"},
  { val:"last7days", label:"Last 7 days"},
];

function getQuickRange(val) {
  const now = nowIST();
  if (val === "today")    return { s: startOfISTDay(now), e: new Date() };
  if (val === "yesterday") {
    const y = new Date(now); y.setUTCDate(y.getUTCDate()-1);
    return { s: startOfISTDay(y), e: endOfISTDay(y) };
  }
  if (val === "last2days") {
    const d = new Date(now); d.setUTCDate(d.getUTCDate()-1);
    return { s: startOfISTDay(d), e: new Date() };
  }
  if (val === "last7days") {
    const d = new Date(now); d.setUTCDate(d.getUTCDate()-6);
    return { s: startOfISTDay(d), e: new Date() };
  }
  return null;
}

function getTodayFilter() {
  const r = getQuickRange("today");
  return { start: r.s.toISOString(), end: r.e.toISOString(), label: "Today" };
}
const TODAY_FILTER = getTodayFilter();

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
    <div className="al-cal-block">
      <div className="al-sb-section-label">
        <span style={{color:accentColor,fontSize:"10px"}}>●</span> {label}
      </div>
      <div className="al-cal-with-time">
        <div className="al-cal-wrapper">
          <div className="al-cal-header">
            <button className="al-cal-nav" onClick={prevM}>‹</button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button className="al-cal-nav" onClick={nextM}>›</button>
          </div>
          <div className="al-cal-grid">
            <div className="al-cal-dow">{DOW.map(d=><span key={d}>{d}</span>)}</div>
            <div className="al-cal-days">
              {cells.map((day,i) => {
                if (!day) return <span key={`e${i}`} className="al-cal-day empty"/>;
                const isToday = day.toDateString()===today.toDateString();
                const isSel   = selected && day.toDateString()===selected.toDateString();
                const inRange = rangeStart&&rangeEnd&&day>rangeStart&&day<rangeEnd;
                let cls="al-cal-day";
                if(isToday) cls+=" today";
                if(isSel)   cls+=" selected";
                else if(inRange) cls+=" in-range";
                return <button key={i} className={cls} onClick={()=>onSelect(day)}>{day.getDate()}</button>;
              })}
            </div>
          </div>
        </div>
        <div className="al-time-panel">
          <div className="al-time-panel-head">TIME</div>
          <div className="al-time-panel-sub">IST · 24H</div>
          <div className="al-time-spin">
            <button className="al-time-spin-btn" onClick={()=>onHoursChange(spin(hours,23,1))}>▲</button>
            <div className="al-time-display" style={{borderColor:accentColor,color:accentColor}}>{padZ(hours)}</div>
            <button className="al-time-spin-btn" onClick={()=>onHoursChange(spin(hours,23,-1))}>▼</button>
          </div>
          <div className="al-time-colon">:</div>
          <div className="al-time-spin">
            <button className="al-time-spin-btn" onClick={()=>onMinutesChange(spin(minutes,59,1))}>▲</button>
            <div className="al-time-display" style={{borderColor:accentColor,color:accentColor}}>{padZ(minutes)}</div>
            <button className="al-time-spin-btn" onClick={()=>onMinutesChange(spin(minutes,59,-1))}>▼</button>
          </div>
          <div className="al-time-selected-box" style={{borderColor:accentColor}}>
            <span className="al-time-selected-date">
              {selected?`${padZ(selected.getDate())}/${padZ(selected.getMonth()+1)}`:"--/--"}
            </span>
            <span className="al-time-selected-time" style={{color:accentColor}}>
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
  const [tab, setTab] = useState("quick");
  const [activeQuick, setActiveQuick] = useState("today");
  const todayIST = nowIST();
  const [startDate,setStartDate] = useState(todayIST);
  const [startH,   setStartH]    = useState(0);
  const [startM,   setStartM]    = useState(0);
  const [endDate,  setEndDate]   = useState(todayIST);
  const [endH,     setEndH]      = useState(23);
  const [endM,     setEndM]      = useState(59);

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
    const r = getQuickRange(val);
    if (!r) return;
    onApply({ start:r.s.toISOString(), end:r.e.toISOString(), label:QUICK_OPTIONS.find(o=>o.val===val)?.label||val });
  };

  const handleCustomApply = () => {
    if (durMs<=0) { alert("End must be after start."); return; }
    const sStr = buildUTCFromParts(startDate,startH,startM);
    const eStr = buildUTCFromParts(endDate,endH,endM);
    onApply({
      start: sStr, end: eStr,
      label:`${padZ(startDate.getDate())}/${padZ(startDate.getMonth()+1)} ${padZ(startH)}:${padZ(startM)} → ${padZ(endDate.getDate())}/${padZ(endDate.getMonth()+1)} ${padZ(endH)}:${padZ(endM)} IST`,
    });
  };

  return (
    <>
      <div className="al-sidebar-overlay" onClick={onClose}/>
      <div className="al-sidebar">
        <div className="al-sb-header">
          <div className="al-sb-title">
            <div className="al-sb-title-icon">
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
          <button className="al-sb-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="al-sb-tabs">
          <button className={`al-sb-tab${tab==="quick"?" active":""}`} onClick={()=>setTab("quick")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            Quick
          </button>
          <button className={`al-sb-tab${tab==="custom"?" active":""}`} onClick={()=>setTab("custom")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            Custom
          </button>
        </div>
        <div className="al-sb-body">
          {tab==="quick" ? (
            <>
              <div className="al-sb-section-label" style={{marginTop:0}}>Select range</div>
              <div className="al-quick-grid">
                {QUICK_OPTIONS.map(o=>(
                  <button key={o.val} className={`al-quick-btn${activeQuick===o.val?" active":""}`}
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
              <div className={`al-duration${durMs<=0?" warn":""}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke={durMs>0?"#15803d":"#c2410c"} strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
                <span>Duration: {durStr}</span>
              </div>
              <button className="al-sb-apply" onClick={handleCustomApply}>Apply Range</button>
            </>
          )}
        </div>
        {tab==="quick" && (
          <div className="al-sb-footer">
            <button className="al-sb-cancel" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════ STATUS BADGE ══════════════════════════════ */
function AlarmStatusBadge({ status }) {
  const s = (status||"").toUpperCase();
  if (s==="ACTIVE")   return <span className="al-badge-active">⚠ Active</span>;
  if (s==="RESOLVED") return <span className="al-badge-resolved">✓ Resolved</span>;
  return <span className="al-badge-unknown">{status||"—"}</span>;
}

/* ══════════════════════════════ COLUMNS ══════════════════════════════ */
const COLUMNS = [
  { key:"sno",        label:"S.No",          width:"58px",  sortable:false },
  { key:"code",       label:"Code",          width:"80px",  sortable:true  },
  { key:"message",    label:"Message",       width:"220px", sortable:true  },
  { key:"cause",      label:"Cause",         width:"280px", sortable:false },
  { key:"status",     label:"Status",        width:"110px", sortable:true  },
  { key:"arrivedAt",  label:"Arrived (IST)", width:"155px", sortable:true  },
  { key:"resolvedAt", label:"Resolved (IST)",width:"155px", sortable:true  },
  { key:"duration",   label:"Duration",      width:"90px",  sortable:false },
];

/* ══════════════════════════════ MAIN COMPONENT ══════════════════════════════ */
export default function Alarms() {
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [badgeText,    setBadgeText]    = useState(TODAY_FILTER.label);
  const [activeFilter, setActiveFilter] = useState({ start:TODAY_FILTER.start, end:TODAY_FILTER.end });
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [data,         setData]         = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page,         setPage]         = useState(1);
  const [rowsPerPage,  setRowsPerPage]  = useState(25);
  const [loading,      setLoading]      = useState(false);
  const [sortKey,      setSortKey]      = useState("arrivedAt");
  const [sortDir,      setSortDir]      = useState("desc");

  /* ── fetch ── */
  const fetchData = useCallback(async (pg, rws, filter, srch) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page:pg, limit:rws });
      if ((srch||"").trim()) params.set("search", srch.trim());
      if (filter?.start && filter?.end) {
        params.set("start", filter.start);
        params.set("end",   filter.end);
      }
      const res  = await fetch(`${API}/all?${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data || []);
        setTotalRecords(json.total || 0);
      }
    } catch(err) {
      console.error("Alarms fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(1, 25, { start:TODAY_FILTER.start, end:TODAY_FILTER.end }, "");
  }, []); // eslint-disable-line

  const handleSidebarApply = ({ start, end, label }) => {
    const f = { start, end };
    setActiveFilter(f); setBadgeText(label); setSidebarOpen(false); setPage(1);
    fetchData(1, rowsPerPage, f, search);
  };

  const handleSearch = () => { setPage(1); fetchData(1, rowsPerPage, activeFilter, search); };

  const handleReset = () => {
    const f = getTodayFilter();
    setSearch(""); setStatusFilter("all");
    setActiveFilter({ start:f.start, end:f.end }); setBadgeText(f.label); setPage(1);
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
    let d = [...data];
    if (sortKey) {
      d.sort((a,b) => {
        let av=a[sortKey]??"", bv=b[sortKey]??"";
        if (sortKey==="arrivedAt"||sortKey==="resolvedAt") { av=new Date(av||0); bv=new Date(bv||0); }
        if (av<bv) return sortDir==="asc"?-1:1;
        if (av>bv) return sortDir==="asc"?1:-1;
        return 0;
      });
    }
    return d;
  }, [data, sortKey, sortDir]);

  /* ── client-side status filter ── */
  const filteredData = useMemo(() => {
    if (statusFilter==="all") return sortedData;
    return sortedData.filter(r => {
      const s=(r.status||"").toUpperCase();
      return statusFilter==="active" ? s==="ACTIVE" : s==="RESOLVED";
    });
  }, [sortedData, statusFilter]);

  /* ── stats ── */
  const stats = useMemo(() => {
    const active   = data.filter(r=>(r.status||"").toUpperCase()==="ACTIVE").length;
    const resolved = data.filter(r=>(r.status||"").toUpperCase()==="RESOLVED").length;
    return { total:totalRecords, active, resolved, page:data.length };
  }, [data, totalRecords]);

  /* ── export ── */
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (activeFilter.start) params.set("start", activeFilter.start);
      if (activeFilter.end)   params.set("end",   activeFilter.end);
      const res  = await fetch(`${API}/export?${params}`);
      const json = await res.json();
      if (!json.success||!json.data?.length) { alert("No data to export."); return; }
      const rows = json.data.map(r=>({
        Code:r.code, Message:r.message, Cause:r.cause,
        Status:r.status,
        "Arrived (IST)": fmtIST(r.arrivedAt),
        "Resolved (IST)":fmtIST(r.resolvedAt),
        Duration: durationStr(r.arrivedAt, r.resolvedAt)||"",
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Alarms");
      XLSX.writeFile(wb, `alarms-${Date.now()}.xlsx`);
    } catch(err) { console.error(err); alert("Export failed."); }
  };

  const handleClear = async () => {
    if (!window.confirm("Delete ALL alarm records? This cannot be undone.")) return;
    try {
      await fetch(`${API}/delete-all`, { method:"DELETE" });
      setData([]); setTotalRecords(0);
    } catch(err) { console.error(err); alert("Failed."); }
  };

  const pageNums = useMemo(() => {
    const nums=[]; const delta=2;
    for(let p=1;p<=totalPages;p++) {
      if(p===1||p===totalPages||(p>=page-delta&&p<=page+delta)) nums.push(p);
      else if(nums[nums.length-1]!=="...") nums.push("...");
    }
    return nums;
  },[page,totalPages]);

  /* ══════════════════════════════ RENDER ══════════════════════════════ */
  return (
    <div className="al-root">
      {loading && (
        <div className="al-loader">
          <div className="al-spinner"/>
          <p className="al-loader-text">Loading alarms…</p>
        </div>
      )}

      {sidebarOpen && (
        <FilterSidebar
          onApply={handleSidebarApply}
          onClose={()=>setSidebarOpen(false)}
        />
      )}

      {/* ══ TOP BAR ══ */}
      <div className="al-topbar">
        <div className="al-brand">
          <span className="al-brand-dot"/>
          Alarm History
        </div>
        <div className="al-sep"/>

        <div className="al-search-wrap">
          <span className="al-search-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </span>
          <input className="al-search" placeholder="Search alarm code…"
            value={search} onChange={e=>setSearch(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleSearch()}
          />
        </div>

        {/* Status pills */}
        <div className="al-status-group">
          {[
            {val:"all",      label:"All",       cls:"sp-all"},
            {val:"active",   label:"⚠ Active",  cls:"sp-active"},
            {val:"resolved", label:"✓ Resolved", cls:"sp-resolved"},
          ].map(p=>(
            <button key={p.val}
              className={`al-status-pill ${p.cls}${statusFilter===p.val?" active":""}`}
              onClick={()=>setStatusFilter(p.val)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="al-sep"/>
        <span className={`al-badge${activeFilter.start?"":" no-filter"}`}>{badgeText}</span>

        <div className="al-topbar-right">
          <button className="al-btn" onClick={handleSearch}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            Query
          </button>
          <button className="al-btn" onClick={handleReset}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Reset
          </button>
          <button className="al-btn al-btn-export" onClick={handleExport}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M5 7l3 3 3-3M3 13h10"/></svg>
            Export
          </button>
          <button className="al-btn al-btn-clear" onClick={handleClear}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>
            Clear All
          </button>
          <button className="al-btn al-btn-filter" onClick={()=>setSidebarOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
            Date &amp; Time Filter
          </button>
        </div>
      </div>

      {/* ══ BODY ══ */}
      <div className={`al-body${sidebarOpen?" sidebar-open":""}`}>

        {/* Stats */}
        <div className="al-stats-row">
          {[
            {icon:"🔔",label:"Total Records",  val:stats.total.toLocaleString(),    cls:"blue"  },
            {icon:"⚠️",label:"Active",          val:stats.active.toLocaleString(),   cls:"red"   },
            {icon:"✅",label:"Resolved",        val:stats.resolved.toLocaleString(), cls:"green" },
            {icon:"📄",label:"This Page",       val:stats.page.toLocaleString(),     cls:"amber" },
          ].map(s=>(
            <div key={s.cls} className="al-stat-card">
              <div className={`al-stat-icon ${s.cls}`}>{s.icon}</div>
              <div>
                <div className="al-stat-label">{s.label}</div>
                <div className="al-stat-value">{s.val}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="al-table-card">
          <div className="al-table-header">
            <div className="al-table-title">
              Alarm Records
              <span className="al-table-count">{filteredData.length} of {totalRecords.toLocaleString()}</span>
            </div>
            <span style={{fontSize:"11px",color:"var(--al-text-muted)"}}>Sorted latest first · click headers to sort</span>
          </div>

          <div className="al-table-scroll">
            {filteredData.length===0 && !loading ? (
              <div className="al-empty">
                <div className="al-empty-icon">🔕</div>
                <div className="al-empty-text">No alarms found — adjust your filters</div>
              </div>
            ) : (
              <table className="al-table">
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
                  {filteredData.map((row,idx)=>(
                    <tr key={row._id?.$oid||row._id||idx}>
                      <td style={{textAlign:"center",color:"var(--al-text-muted)",fontSize:"11px"}}>
                        {(page-1)*rowsPerPage+idx+1}
                      </td>
                      <td className="mono" style={{fontWeight:600}}>{row.code}</td>
                      <td className="wrap" title={row.message}>{row.message||"—"}</td>
                      <td className="wrap" title={row.cause} style={{color:"var(--al-text-sec)",fontSize:"11.5px"}}>{row.cause||"—"}</td>
                      <td><AlarmStatusBadge status={row.status}/></td>
                      <td className="mono">{fmtIST(row.arrivedAt)}</td>
                      <td className="mono">{fmtIST(row.resolvedAt)}</td>
                      <td>
                        {durationStr(row.arrivedAt,row.resolvedAt)
                          ? <span className="al-duration-pill">⏱ {durationStr(row.arrivedAt,row.resolvedAt)}</span>
                          : <span style={{color:"var(--al-text-muted)",fontSize:"11px"}}>—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          <div className="al-pagination">
            <div className="al-pagination-left">
              <span className="al-pagination-info">Rows per page:</span>
              <select className="al-rows-select" value={rowsPerPage}
                onChange={e=>handleRowsChange(Number(e.target.value))}>
                {[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <span className="al-pagination-info">
                Page {page} of {totalPages} · {totalRecords.toLocaleString()} total
              </span>
            </div>
            <div className="al-pagination-right">
              <button className="al-page-btn" disabled={page<=1} onClick={()=>handlePageChange(1)}>«</button>
              <button className="al-page-btn" disabled={page<=1} onClick={()=>handlePageChange(page-1)}>‹</button>
              {pageNums.map((p,i)=>
                p==="..."
                  ? <span key={`el${i}`} style={{padding:"0 3px",color:"var(--al-text-muted)",fontSize:"12px"}}>…</span>
                  : <button key={p} className={`al-page-btn${p===page?" active":""}`} onClick={()=>handlePageChange(p)}>{p}</button>
              )}
              <button className="al-page-btn" disabled={page>=totalPages} onClick={()=>handlePageChange(page+1)}>›</button>
              <button className="al-page-btn" disabled={page>=totalPages} onClick={()=>handlePageChange(totalPages)}>»</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}