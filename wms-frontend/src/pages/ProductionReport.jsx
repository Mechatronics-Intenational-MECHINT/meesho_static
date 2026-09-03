import React, { useState, useCallback, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Filler, Tooltip, Legend,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import * as XLSX from "xlsx";
import "../styles/ProductionReport.css";

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Filler, Tooltip, Legend
);

const API_BOX    = "http://localhost:5001/api/boxdata";
const API_ALARMS = "http://localhost:5001/api/alarms";
const PAGE_LIMIT = 1000;

/* ═══════════════════════════════ IST UTILS ═══════════════════════════════ */
const IST_MS = 5.5 * 3600 * 1000;
const toIST  = (d) => new Date(d.getTime() + IST_MS);
const padZ   = (n) => String(n).padStart(2, "0");
const nowIST = ()  => toIST(new Date());

function toLocalIST(utcDate) {
  const i = toIST(utcDate);
  return `${i.getFullYear()}-${padZ(i.getMonth()+1)}-${padZ(i.getDate())}T${padZ(i.getHours())}:${padZ(i.getMinutes())}`;
}
function startOfISTDay(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0) - IST_MS);
}
function endOfISTDay(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59) - IST_MS);
}
function istStringToUTC(s) { return new Date(s + "+05:30").toISOString(); }

const QUICK_OPTIONS = [
  { val:"today",     label:"Today" },
  { val:"yesterday", label:"Yesterday" },
  { val:"last2days", label:"Last 2 days" },
  { val:"last7days", label:"Last 7 days" },
];

function getQuickRange(val) {
  const now = nowIST();
  if (val === "today")    return { s: startOfISTDay(now), e: new Date() };
  if (val === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate()-1);
    return { s: startOfISTDay(y), e: endOfISTDay(y) };
  }
  if (val === "last2days") {
    const d = new Date(now); d.setDate(d.getDate()-1);
    return { s: startOfISTDay(d), e: new Date() };
  }
  if (val === "last7days") {
    const d = new Date(now); d.setDate(d.getDate()-6);
    return { s: startOfISTDay(d), e: new Date() };
  }
  return null;
}

/* ═══════════════════════════════ SORT KEY ═══════════════════════════════ */
function keyToSortVal(key) {
  const parts = key.split(" ");
  const [dd, mm] = parts[0].split("/").map(Number);
  const hh = parts[1] ? parseInt(parts[1]) : 0;
  return mm * 10000 + dd * 100 + hh;
}

/* ═══════════════════════ BUCKET — box data ═══════════════════════ */
function bucketBoxData(data, byHour) {
  const map = {};
  data.forEach((item) => {
    const ist = item.dateIST
      ? new Date(item.dateIST.replace(" ", "T") + "+05:30")
      : toIST(new Date(item.createdAt));
    const key = byHour
      ? `${padZ(ist.getDate())}/${padZ(ist.getMonth()+1)} ${padZ(ist.getHours())}:00`
      : `${padZ(ist.getDate())}/${padZ(ist.getMonth()+1)}`;
    if (!map[key])
      map[key] = { total:0, pass:0, fail:0, uploaded:0, missing:0, imgPresent:0, imgMissing:0 };
    const b = map[key];
    b.total++;
    (item.status||"").toLowerCase() === "pass" ? b.pass++ : b.fail++;
    item.DWS_Status ? b.uploaded++ : b.missing++;
    (item.imagePath && item.imagePath !== "image_missing") ? b.imgPresent++ : b.imgMissing++;
  });
  const keys = Object.keys(map).sort((a,b) => keyToSortVal(a) - keyToSortVal(b));
  return { keys, map };
}

/* ═══════════════════════ BUCKET — alarm occurrences ═══════════════════════ */
function bucketAlarmData(data, byHour) {
  const map = {};
  data.forEach((item) => {
    const ist = toIST(new Date(item.arrivedAt));
    const key = byHour
      ? `${padZ(ist.getDate())}/${padZ(ist.getMonth()+1)} ${padZ(ist.getHours())}:00`
      : `${padZ(ist.getDate())}/${padZ(ist.getMonth()+1)}`;
    map[key] = (map[key] || 0) + 1;
  });
  const keys = Object.keys(map).sort((a,b) => keyToSortVal(a) - keyToSortVal(b));
  return { keys, map };
}

/* ═══════════════════════ ALARM FREQUENCY — by message ═══════════════════════ */
function buildAlarmFrequency(data) {
  const freq = {};
  data.forEach((item) => {
    const msg = item.message || `Code ${item.code}`;
    freq[msg] = (freq[msg] || 0) + 1;
  });
  // sort descending by count
  const sorted = Object.entries(freq).sort((a,b) => b[1] - a[1]);
  return { labels: sorted.map(([msg]) => msg), counts: sorted.map(([,c]) => c) };
}

/* ═══════════════════════ HOUR SLOTS — for throughput full timeline ═══════════════════════ */
function buildHourSlots(startISTDate, endISTDate) {
  const slots = [];
  const cur = new Date(startISTDate);
  cur.setMinutes(0, 0, 0);
  while (cur <= endISTDate) {
    const ist = toIST(cur);
    slots.push(`${padZ(ist.getDate())}/${padZ(ist.getMonth()+1)} ${padZ(ist.getHours())}:00`);
    cur.setTime(cur.getTime() + 3600000);
  }
  return slots;
}

/**
 * Convert "DD/MM HH:00" bucket key into interval label "HH:00–HH+1:00"
 * For daily keys "DD/MM" keep as-is.
 */
function toIntervalLabel(key) {
  const parts = key.split(" ");
  if (parts.length < 2) return key; // daily → "13/03"
  const hh = parseInt(parts[1]);
  const nextHH = (hh + 1) % 24;
  return `${padZ(hh)}:00–${padZ(nextHH)}:00`;
}

/* ═══════════════════════ Y AXIS ═══════════════════════ */
function niceYScale(values = [], stacked = false) {
  let rawMax = 0;
  if (stacked) {
    const len = Math.max(...values.map(a => a.length));
    for (let i=0; i<len; i++) rawMax = Math.max(rawMax, values.reduce((s,a) => s+(a[i]||0), 0));
  } else {
    rawMax = Math.max(0, ...values.flat());
  }
  if (!rawMax) return { min:0, max:10, ticks:{ stepSize:2 } };
  const rough = rawMax / 6;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  const res   = rough / mag;
  const step  = res < 1.5 ? 1*mag : res < 3 ? 2*mag : res < 7 ? 5*mag : 10*mag;
  return { min:0, max: Math.ceil(rawMax/step)*step, ticks:{ stepSize:step } };
}

/* ═══════════════════════ CHART OPTIONS ═══════════════════════ */
const TOOLTIP = {
  backgroundColor:"#1a1f36", titleColor:"#fff",
  bodyColor:"rgba(255,255,255,.72)", padding:10, cornerRadius:8, displayColors:true,
  titleFont:{ family:"'Inter'", size:12, weight:"600" },
  bodyFont: { family:"'Inter'", size:11 },
};

function makeOptions(dataArrays=[], stacked=false, extraX={}) {
  const ys = niceYScale(dataArrays, stacked);
  return {
    responsive:true, maintainAspectRatio:false,
    animation:{ duration:500, easing:"easeOutQuart" },
    plugins:{ legend:{ display:false }, tooltip:TOOLTIP },
    scales:{
      x:{
        stacked,
        grid:{ color:"rgba(0,0,0,0.04)", drawBorder:false },
        ticks:{
          color:"#9ca3af", font:{ family:"'Inter'", size:10 },
          maxRotation:45, autoSkip:true, maxTicksLimit:24,
          ...extraX,
        },
        border:{ dash:[4,4] },
      },
      y:{
        stacked, grid:{ color:"rgba(0,0,0,0.05)", drawBorder:false },
        beginAtZero:true, ...ys,
        ticks:{ ...ys.ticks, color:"#9ca3af", font:{ family:"'Inter'", size:11 } },
        border:{ dash:[4,4] },
      },
    },
  };
}

/** Horizontal bar chart options for alarm frequency */
function makeHorizOptions(dataArr=[]) {
  const ys = niceYScale([dataArr]);
  return {
    indexAxis: "y",          // horizontal bars
    responsive:true, maintainAspectRatio:false,
    animation:{ duration:500, easing:"easeOutQuart" },
    plugins:{
      legend:{ display:false },
      tooltip:{
        ...TOOLTIP,
        callbacks:{
          label: ctx => ` ${ctx.parsed.x} occurrences`,
        },
      },
    },
    scales:{
      x:{
        grid:{ color:"rgba(0,0,0,0.05)", drawBorder:false },
        beginAtZero:true, ...ys,
        ticks:{ ...ys.ticks, color:"#9ca3af", font:{ family:"'Inter'", size:11 } },
        border:{ dash:[4,4] },
      },
      y:{
        grid:{ color:"rgba(0,0,0,0.04)", drawBorder:false },
        ticks:{
          color:"#374151", font:{ family:"'Inter'", size:11 },
          autoSkip:false,
        },
        border:{ dash:[4,4] },
      },
    },
  };
}

/* ═══════════════════════ CALENDAR WITH INLINE TIME ═══════════════════════ */
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

  const prevM = () => setView(v => v.m===0 ? {y:v.y-1,m:11} : {y:v.y,m:v.m-1});
  const nextM = () => setView(v => v.m===11 ? {y:v.y+1,m:0} : {y:v.y,m:v.m+1});
  const spin  = (val, max, dir) => (val + dir + max + 1) % (max+1);

  return (
    <div className="pr-cal-block">
      <div className="pr-sb-section-label">
        <span style={{color:accentColor,fontSize:"10px"}}>●</span> {label}
      </div>
      <div className="pr-cal-with-time">

        {/* ── Calendar ── */}
        <div className="pr-cal-wrapper">
          <div className="pr-cal-header">
            <button className="pr-cal-nav" onClick={prevM}>‹</button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button className="pr-cal-nav" onClick={nextM}>›</button>
          </div>
          <div className="pr-cal-grid">
            <div className="pr-cal-dow">
              {DOW.map(d => <span key={d}>{d}</span>)}
            </div>
            <div className="pr-cal-days">
              {cells.map((day, i) => {
                if (!day) return <span key={`e${i}`} className="pr-cal-day empty"/>;
                const isToday = day.toDateString() === today.toDateString();
                const isSel   = selected && day.toDateString() === selected.toDateString();
                const inRange = rangeStart && rangeEnd && day > rangeStart && day < rangeEnd;
                let cls = "pr-cal-day";
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

        {/* ── Time panel ── */}
        <div className="pr-time-panel">
          <div className="pr-time-panel-head">TIME</div>
          <div className="pr-time-panel-sub">IST · 24H</div>

          {/* Hours */}
          <div className="pr-time-spin">
            <button className="pr-time-spin-btn" onClick={() => onHoursChange(spin(hours,23,1))}>▲</button>
            <div className="pr-time-display" style={{borderColor:accentColor, color:accentColor}}>
              {padZ(hours)}
            </div>
            <button className="pr-time-spin-btn" onClick={() => onHoursChange(spin(hours,23,-1))}>▼</button>
          </div>

          <div className="pr-time-colon">:</div>

          {/* Minutes */}
          <div className="pr-time-spin">
            <button className="pr-time-spin-btn" onClick={() => onMinutesChange(spin(minutes,59,1))}>▲</button>
            <div className="pr-time-display" style={{borderColor:accentColor, color:accentColor}}>
              {padZ(minutes)}
            </div>
            <button className="pr-time-spin-btn" onClick={() => onMinutesChange(spin(minutes,59,-1))}>▼</button>
          </div>

          {/* Selected summary */}
          <div className="pr-time-selected-box" style={{borderColor:accentColor}}>
            <span className="pr-time-selected-date">
              {selected ? `${padZ(selected.getDate())}/${padZ(selected.getMonth()+1)}` : "--/--"}
            </span>
            <span className="pr-time-selected-time" style={{color:accentColor}}>
              {padZ(hours)}:{padZ(minutes)}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ═══════════════════════ FILTER SIDEBAR ═══════════════════════ */
function FilterSidebar({ onApply, onClose, initialStart, initialEnd }) {
  const [tab, setTab] = useState("quick");
  const [activeQuick, setActiveQuick] = useState("");

  const todayIST = nowIST();
  const [startDate, setStartDate] = useState(initialStart || todayIST);
  const [startH,    setStartH]    = useState(0);
  const [startM,    setStartM]    = useState(0);
  const [endDate,   setEndDate]   = useState(initialEnd   || todayIST);
  const [endH,      setEndH]      = useState(23);
  const [endM,      setEndM]      = useState(59);

  const buildIST = (date,h,m) =>
    `${date.getFullYear()}-${padZ(date.getMonth()+1)}-${padZ(date.getDate())}T${padZ(h)}:${padZ(m)}`;

  const durMs = useMemo(() => {
    const s = new Date(buildIST(startDate,startH,startM)+"+05:30");
    const e = new Date(buildIST(endDate,endH,endM)+"+05:30");
    return e - s;
  }, [startDate,startH,startM,endDate,endH,endM]);

  const durStr = useMemo(() => {
    if (durMs <= 0) return "Invalid range";
    const h = Math.floor(durMs/3600000);
    const m = Math.floor((durMs%3600000)/60000);
    return `${h}h ${padZ(m)}m`;
  }, [durMs]);

  const handleQuickApply = (val) => {
    setActiveQuick(val);
    const r = getQuickRange(val);
    if (!r) return;
    onApply({ startIST:toLocalIST(r.s), endIST:toLocalIST(r.e), label:QUICK_OPTIONS.find(o=>o.val===val)?.label||val });
  };

  const handleCustomApply = () => {
    if (durMs <= 0) { alert("End must be after start."); return; }
    const sStr = buildIST(startDate,startH,startM);
    const eStr = buildIST(endDate,endH,endM);
    onApply({ startIST:sStr, endIST:eStr, label:`${sStr.replace("T"," ")} → ${eStr.replace("T"," ")} IST` });
  };

  return (
    <>
      <div className="pr-sidebar-overlay" onClick={onClose}/>
      <div className="pr-sidebar">

        <div className="pr-sb-header">
          <div className="pr-sb-title">
            <div className="pr-sb-title-icon">
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
          <button className="pr-sb-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="pr-sb-tabs">
          <button className={`pr-sb-tab${tab==="quick"?" active":""}`} onClick={()=>setTab("quick")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            Quick
          </button>
          <button className={`pr-sb-tab${tab==="custom"?" active":""}`} onClick={()=>setTab("custom")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            Custom
          </button>
        </div>

        <div className="pr-sb-body">
          {tab === "quick" ? (
            <>
              <div className="pr-sb-section-label" style={{marginTop:0}}>Select range</div>
              <div className="pr-quick-grid">
                {QUICK_OPTIONS.map(o => (
                  <button key={o.val}
                    className={`pr-quick-btn${activeQuick===o.val?" active":""}`}
                    onClick={() => handleQuickApply(o.val)}>
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
              <div className={`pr-duration${durMs<=0?" warn":""}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke={durMs>0?"#15803d":"#c2410c"} strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
                <span>Duration: {durStr}</span>
              </div>
              <button className="pr-sb-apply" onClick={handleCustomApply}>Apply Range</button>
            </>
          )}
        </div>

        {tab === "quick" && (
          <div className="pr-sb-footer">
            <button className="pr-sb-cancel" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ═══════════════════════ SHARED COMPONENTS ═══════════════════════ */
function CountToggle({ on, onChange }) {
  return (
    <div className="pr-count-toggle" onClick={onChange}>
      <span>Count</span>
      <div className={`pr-toggle-track${on?" on":""}`}><div className="pr-toggle-thumb"/></div>
    </div>
  );
}

function DlBtn({ onClick }) {
  return (
    <button className="pr-dl-btn" onClick={onClick}>
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2v8M5 7l3 3 3-3M3 13h10"/>
      </svg>
      Excel
    </button>
  );
}

function ChartCard({ title, dotColor, showCount, onToggleCount, onDownload, height=260, legend, info, children }) {
  return (
    <div className="pr-chart-card">
      <div className="pr-chart-header">
        <div className="pr-chart-title">
          <span className="pr-title-dot" style={{background:dotColor}}/>
          {title}
        </div>
        <div className="pr-chart-actions">
          {onToggleCount && <CountToggle on={showCount} onChange={onToggleCount}/>}
          {onDownload    && <DlBtn onClick={onDownload}/>}
        </div>
      </div>
      <div className="pr-canvas-wrap" style={{height}}>{children}</div>
      {info && <p className="pr-chart-info">{info}</p>}
      {legend && (
        <div className="pr-legend">
          {legend.map(l => (
            <div className="pr-legend-item" key={l.label}>
              <div className="pr-legend-dot" style={{background:l.color}}/>{l.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ MAIN COMPONENT ═══════════════════════ */
export default function ProductionReport() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [badgeText,   setBadgeText]   = useState("No filter applied");
  const [activeStart, setActiveStart] = useState(null);
  const [activeEnd,   setActiveEnd]   = useState(null);

  const [loading,    setLoading]    = useState(false);
  const [rawData,    setRawData]    = useState([]);
  const [alarmRaw,   setAlarmRaw]   = useState([]);
  const [byHour,     setByHour]     = useState(false);
  const [stats,      setStats]      = useState({ total:0, pass:0, fail:0, rate:"—" });

  const [ct, setCt] = useState({
    throughput:false, passreject:false, alarms:false, shipments:false, images:false
  });
  const toggleCt = (k) => setCt(p => ({...p,[k]:!p[k]}));

  /* ── fetch box data ── */
  const fetchBoxData = useCallback(async (startIST, endIST) => {
    let all=[], page=1;
    while (true) {
      const url = `${API_BOX}/boxdata?startDateTime=${encodeURIComponent(startIST)}&endDateTime=${encodeURIComponent(endIST)}&page=${page}&limit=${PAGE_LIMIT}`;
      const json = await (await fetch(url)).json();
      if (!json.success || !json.data?.length) break;
      all = [...all, ...json.data];
      if (all.length >= json.totalRecords || json.data.length < PAGE_LIMIT) break;
      page++;
    }
    return all;
  }, []);

  /* ── fetch alarm data ── */
  const fetchAlarmData = useCallback(async (startIST, endIST) => {
    const startUTC = istStringToUTC(startIST);
    const endUTC   = istStringToUTC(endIST);
    let all=[], page=1;
    while (true) {
      const url = `${API_ALARMS}/all?start=${encodeURIComponent(startUTC)}&end=${encodeURIComponent(endUTC)}&page=${page}&limit=${PAGE_LIMIT}`;
      const json = await (await fetch(url)).json();
      if (!json.success || !json.data?.length) break;
      all = [...all, ...json.data];
      // alarm route uses json.total (not totalRecords)
      if (all.length >= json.total || json.data.length < PAGE_LIMIT) break;
      page++;
    }
    return all;
  }, []);

  /* ── combined fetch ── */
  const fetchAll = useCallback(async (startIST, endIST) => {
    setLoading(true);
    try {
      const [boxAll, almAll] = await Promise.all([
        fetchBoxData(startIST, endIST),
        fetchAlarmData(startIST, endIST),
      ]);
      const total = boxAll.length;
      const pass  = boxAll.filter(d => (d.status||"").toLowerCase()==="pass").length;
      const fail  = total - pass;
      setStats({ total, pass, fail, rate: total ? (fail/total*100).toFixed(2)+"%" : "—" });
      setRawData(boxAll);
      setAlarmRaw(almAll);
    } catch(err) {
      console.error(err);
      alert("Cannot reach API at localhost:5001.");
    } finally {
      setLoading(false);
    }
  }, [fetchBoxData, fetchAlarmData]);

  const handleApply = ({ startIST, endIST, label }) => {
    const diffHrs = (new Date(endIST+"+05:30") - new Date(startIST+"+05:30")) / 3600000;
    const hourMode = diffHrs <= 48;
    setByHour(hourMode);
    setActiveStart(startIST); setActiveEnd(endIST);
    setBadgeText(label + (hourMode ? "  ·  hourly" : "  ·  daily"));
    setSidebarOpen(false);
    fetchAll(startIST, endIST);
  };

  const handleReset = () => {
    setBadgeText("No filter applied");
    setActiveStart(null); setActiveEnd(null);
    setRawData([]); setAlarmRaw([]); setByHour(false);
    setStats({ total:0, pass:0, fail:0, rate:"—" });
    setCt({ throughput:false, passreject:false, alarms:false, shipments:false, images:false });
  };

  /* ── bucket data ── */
  const { keys:boxKeys, map:boxMap } = bucketBoxData(rawData, byHour);
  const { keys:almKeys, map:almMap } = bucketAlarmData(alarmRaw, byHour);

  /* throughput — full hour slots */
  const throughputLabels = useMemo(() => {
    if (!byHour || !activeStart || !activeEnd) return boxKeys.length ? boxKeys : ["No data"];
    const slots = buildHourSlots(new Date(activeStart+"+05:30"), new Date(activeEnd+"+05:30"));
    return slots.length ? slots : (boxKeys.length ? boxKeys : ["No data"]);
  }, [byHour, activeStart, activeEnd, boxKeys]);

  /* alarm occurrence — fill all hour slots so every hour shows (even if 0) */
  const alarmLabels = useMemo(() => {
    if (!byHour || !activeStart || !activeEnd) return almKeys.length ? almKeys : ["No data"];
    const slots = buildHourSlots(new Date(activeStart+"+05:30"), new Date(activeEnd+"+05:30"));
    return slots.length ? slots : (almKeys.length ? almKeys : ["No data"]);
  }, [byHour, activeStart, activeEnd, almKeys]);

  /* ── convert bucket keys to interval labels for X axis ── */
  const throughputXLabels = throughputLabels.map(toIntervalLabel);
  const alarmXLabels      = alarmLabels.map(toIntervalLabel);
  const boxXLabels        = boxKeys.length ? boxKeys.map(toIntervalLabel) : ["No data"];

  const boxLabels = boxKeys.length ? boxKeys : ["No data"];

  /* data arrays */
  const totalArr = throughputLabels.map(k => boxMap[k]?.total    || 0);
  const passArr  = boxLabels.map(k => boxMap[k]?.pass       || 0);
  const failArr  = boxLabels.map(k => boxMap[k]?.fail       || 0);
  const upArr    = boxLabels.map(k => boxMap[k]?.uploaded   || 0);
  const missArr  = boxLabels.map(k => boxMap[k]?.missing    || 0);
  const imgPArr  = boxLabels.map(k => boxMap[k]?.imgPresent || 0);
  const imgMArr  = boxLabels.map(k => boxMap[k]?.imgMissing || 0);
  const almArr   = alarmLabels.map(k => almMap[k] || 0);

  /* alarm frequency by message */
  const { labels:freqLabels, counts:freqCounts } = buildAlarmFrequency(alarmRaw);
  // dynamic height: at least 200px, 36px per alarm type
  const freqChartHeight = Math.max(220, freqLabels.length * 38 + 40);

  const dlLabel = (on) => ({
    display:on, anchor:"end", align:"top",
    font:{ family:"'JetBrains Mono'", size:9 },
    color:"#6b7280", formatter: v => v===0?"":v,
  });

  /* chart datasets */
  const throughputData = { labels: throughputXLabels, datasets:[{
    label:"Parcels scanned", data:totalArr,
    borderColor:"#2563eb", backgroundColor:"rgba(37,99,235,0.1)",
    borderWidth:2.5, pointRadius:3, pointHoverRadius:5,
    pointBackgroundColor:"#2563eb", fill:true, tension:0.35,
    datalabels:dlLabel(ct.throughput),
  }]};

  const passRejectData = { labels:boxXLabels, datasets:[
    { label:"Pass",     data:passArr, backgroundColor:"#10b981", borderRadius:5, borderSkipped:false, datalabels:dlLabel(ct.passreject) },
    { label:"Rejected", data:failArr, backgroundColor:"#ef4444", borderRadius:5, borderSkipped:false, datalabels:dlLabel(ct.passreject) },
  ]};

  const alarmOccData = { labels:alarmXLabels, datasets:[{
    label:"Alarm occurrences", data:almArr,
    backgroundColor:"#f59e0b", borderRadius:5, borderSkipped:false,
    datalabels:dlLabel(ct.alarms),
  }]};

  const shipmentsData = { labels:boxXLabels, datasets:[
    { label:"Uploaded", data:upArr,   backgroundColor:"#8b5cf6", borderRadius:4, borderSkipped:false, datalabels:dlLabel(ct.shipments) },
    { label:"Missing",  data:missArr, backgroundColor:"#e5e7eb", borderRadius:4, borderSkipped:false, datalabels:dlLabel(ct.shipments) },
  ]};

  const imagesData = { labels:boxXLabels, datasets:[
    { label:"Present", data:imgPArr, backgroundColor:"#f97316", borderRadius:4, borderSkipped:false, datalabels:dlLabel(ct.images) },
    { label:"Missing", data:imgMArr, backgroundColor:"#e5e7eb", borderRadius:4, borderSkipped:false, datalabels:dlLabel(ct.images) },
  ]};

  // Alarm frequency horizontal bar
  const alarmFreqData = { labels:freqLabels, datasets:[{
    label:"Occurrences",
    data:freqCounts,
    backgroundColor: freqCounts.map((_,i) => {
      const palette = ["#ef4444","#f59e0b","#8b5cf6","#2563eb","#10b981","#f97316","#06b6d4","#ec4899"];
      return palette[i % palette.length] + "cc";
    }),
    borderRadius:5, borderSkipped:false,
  }]};

  const optsThroughput = makeOptions([totalArr]);
  const optsPR         = makeOptions([passArr,failArr]);
  const optsAlarms     = makeOptions([almArr]);
  const optsShipments  = makeOptions([upArr,missArr],true);
  const optsImages     = makeOptions([imgPArr,imgMArr],true);
  const optsFreq       = makeHorizOptions(freqCounts);

  /* Excel download */
  const downloadExcel = (type) => {
    const wb = XLSX.utils.book_new();
    if (type === "alarms") {
      if (!alarmRaw.length) { alert("No alarm data."); return; }
      const { keys:k, map:m } = bucketAlarmData(alarmRaw, byHour);
      const rows = k.map(x => ({ Period:x, "Alarm Occurrences":m[x] }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Alarms");
      XLSX.writeFile(wb, "alarms.xlsx"); return;
    }
    if (type === "alarmfreq") {
      if (!alarmRaw.length) { alert("No alarm data."); return; }
      const rows = freqLabels.map((msg,i) => ({ Message:msg, Occurrences:freqCounts[i] }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Alarm Frequency");
      XLSX.writeFile(wb, "alarm_frequency.xlsx"); return;
    }
    if (!rawData.length) { alert("No data loaded."); return; }
    const { keys:k, map:m } = bucketBoxData(rawData, byHour);
    const cfgs = {
      throughput: { rows:k.map(x=>({Period:toIntervalLabel(x),"Total":m[x].total})),                                      name:"Throughput",       file:"throughput.xlsx" },
      passreject: { rows:k.map(x=>({Period:toIntervalLabel(x),Pass:m[x].pass,Rejected:m[x].fail})),                       name:"Pass vs Rejected", file:"pass_vs_rejected.xlsx" },
      shipments:  { rows:k.map(x=>({Period:toIntervalLabel(x),Uploaded:m[x].uploaded,Missing:m[x].missing})),             name:"Shipments Upload", file:"shipments_upload.xlsx" },
      images:     { rows:k.map(x=>({Period:toIntervalLabel(x),"Image Present":m[x].imgPresent,"Image Missing":m[x].imgMissing})), name:"Image Upload", file:"image_upload.xlsx" },
    };
    const {rows,name,file} = cfgs[type];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    XLSX.writeFile(wb, file);
  };

  const infoText = rawData.length
    ? byHour ? "Grouped hourly · IST · 24h"
             : "Grouped by date · IST"
    : "";

  /* ═══════════════════════ RENDER ═══════════════════════ */
  return (
    <div className="pr-root">
      {loading && (
        <div className="pr-loader">
          <div className="pr-spinner"/>
          <p className="pr-loader-text">Fetching production data…</p>
        </div>
      )}

      {sidebarOpen && (
        <FilterSidebar
          onApply={handleApply}
          onClose={() => setSidebarOpen(false)}
          initialStart={activeStart ? new Date(activeStart+"+05:30") : null}
          initialEnd={activeEnd   ? new Date(activeEnd  +"+05:30") : null}
        />
      )}

      {/* TOP BAR */}
      <div className="pr-topbar">
        <div className="pr-brand"><span className="pr-brand-dot"/>Production Report</div>
        <div className="pr-sep"/>
        <span className="pr-badge">{badgeText}</span>
        <div className="pr-topbar-right">
          {(rawData.length > 0 || alarmRaw.length > 0) && (
            <button className="pr-btn-reset-top" onClick={handleReset}>Reset</button>
          )}
          <button className="pr-filter-trigger" onClick={() => setSidebarOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
            </svg>
            Date &amp; Time Filter
          </button>
        </div>
      </div>

      {/* BODY */}
      <div className={`pr-body${sidebarOpen?" sidebar-open":""}`}>

        {/* STAT CARDS */}
        <div className="pr-stat-grid">
          {[
            { cls:"s1", icon:"📦", label:"Shipments Scanned",  val: stats.total ? stats.total.toLocaleString() : "—" },
            { cls:"s2", icon:"✅", label:"Shipments Passed",   val: stats.pass  ? stats.pass.toLocaleString()  : "—" },
            { cls:"s3", icon:"⚠️", label:"Shipments Rejected", val: stats.fail  ? stats.fail.toLocaleString()  : "—" },
            { cls:"s4", icon:"📊", label:"Rejection %",         val: stats.rate },
          ].map(s => (
            <div key={s.cls} className={`pr-stat-card ${s.cls}`}>
              <div className="pr-stat-icon-wrap">{s.icon}</div>
              <div className="pr-stat-label">{s.label}</div>
              <div className="pr-stat-value">{s.val}</div>
            </div>
          ))}
        </div>

        {/* Throughput — full width */}
        <div className="pr-row-full">
          <ChartCard title="Sorter Throughput (Time)" dotColor="#2563eb"
            showCount={ct.throughput} onToggleCount={()=>toggleCt("throughput")}
            onDownload={()=>downloadExcel("throughput")} height={300} info={infoText}
            legend={[{color:"#2563eb",label:"Parcels scanned"}]}>
            <Line data={throughputData} options={optsThroughput}/>
          </ChartCard>
        </div>

        {/* Pass vs Rejected | Alarms */}
        <div className="pr-row-half">
          <ChartCard title="Pass vs Rejected" dotColor="#10b981"
            showCount={ct.passreject} onToggleCount={()=>toggleCt("passreject")}
            onDownload={()=>downloadExcel("passreject")}
            legend={[{color:"#10b981",label:"Pass"},{color:"#ef4444",label:"Rejected"}]}>
            <Bar data={passRejectData} options={optsPR}/>
          </ChartCard>

          <ChartCard title="No. of Alarms" dotColor="#f59e0b"
            showCount={ct.alarms} onToggleCount={()=>toggleCt("alarms")}
            onDownload={()=>downloadExcel("alarms")}
            info={alarmRaw.length ? `${alarmRaw.length} total · ${alarmRaw.filter(a=>a.status==="ACTIVE").length} active` : ""}
            legend={[{color:"#f59e0b",label:"Occurrences per interval"}]}>
            <Bar data={alarmOccData} options={optsAlarms}/>
          </ChartCard>
        </div>

        {/* Shipments Upload | Image Upload */}
        <div className="pr-row-half">
          <ChartCard title="Shipments Upload" dotColor="#8b5cf6"
            showCount={ct.shipments} onToggleCount={()=>toggleCt("shipments")}
            onDownload={()=>downloadExcel("shipments")}
            legend={[{color:"#8b5cf6",label:"Uploaded"},{color:"#e5e7eb",label:"Missing"}]}>
            <Bar data={shipmentsData} options={optsShipments}/>
          </ChartCard>

          <ChartCard title="Image Upload" dotColor="#f97316"
            showCount={ct.images} onToggleCount={()=>toggleCt("images")}
            onDownload={()=>downloadExcel("images")}
            legend={[{color:"#f97316",label:"Image present"},{color:"#e5e7eb",label:"Image missing"}]}>
            <Bar data={imagesData} options={optsImages}/>
          </ChartCard>
        </div>

        {/* Alarm Frequency — full width horizontal bar */}
        <div className="pr-row-full">
          <ChartCard
            title="Alarm Frequency by Message"
            dotColor="#ef4444"
            onDownload={() => downloadExcel("alarmfreq")}
            height={freqChartHeight}
            info={freqLabels.length ? `${freqLabels.length} distinct alarm type${freqLabels.length!==1?"s":""}` : "Apply filter to see alarm frequency"}
            legend={[{color:"#ef4444",label:"Occurrences"},{color:"#f59e0b",label:"Higher = more frequent"}]}
          >
            {freqLabels.length > 0 ? (
              <Bar data={alarmFreqData} options={optsFreq}/>
            ) : (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#9ca3af",fontSize:"13px"}}>
                No alarm data — apply a date filter first
              </div>
            )}
          </ChartCard>
        </div>

      </div>
    </div>
  );
}