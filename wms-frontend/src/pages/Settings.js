import React, { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import '../styles/SettingsPage.css';

/* ─── Icons ─── */
const Icon = {
  Machine: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="1" y="3" width="14" height="10" rx="2" />
      <path d="M5 13v2M11 13v2M3 15h10" strokeLinecap="round" />
    </svg>
  ),
  Api: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 1l2.5 4.5H5.5L8 1Z" strokeLinejoin="round" />
      <circle cx="13" cy="12" r="2.5" />
      <circle cx="3" cy="12" r="2.5" />
      <path d="M5.5 12h5M8 5.5V12" strokeLinecap="round" />
    </svg>
  ),
  Calibration: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" strokeLinecap="round" />
    </svg>
  ),
  Box: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 1L14 4.5v7L8 15 2 11.5v-7L8 1Z" strokeLinejoin="round" />
      <path d="M8 1v14M2 4.5l6 3.5 6-3.5" strokeLinecap="round" />
    </svg>
  ),
  Regex: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 4h10M3 8h7M3 12h4" strokeLinecap="round" />
    </svg>
  ),
  Edit: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9.5 1.5l3 3L4 13H1V10L9.5 1.5Z" strokeLinejoin="round" />
    </svg>
  ),
  Download: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 2v8M5 7l3 4 3-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 13v.5A.5.5 0 002.5 14h11a.5.5 0 00.5-.5V13" strokeLinecap="round" />
    </svg>
  ),
  Send: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M14 8l-6-6v3.5C3 6 1 9.5 1 14c2-3 5-4.5 7-4.5V13l6-5Z" strokeLinejoin="round" />
    </svg>
  ),
  Close: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M2 2l10 10M12 2L2 12" strokeLinecap="round" />
    </svg>
  ),
  Save: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M7 1l5 5H9v5H5V6H2L7 1Z" strokeLinejoin="round" />
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 7l4 4 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Warning: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M7 1L13 12H1L7 1Z" strokeLinejoin="round" />
      <path d="M7 5.5v3M7 10.5h.01" strokeLinecap="round" />
    </svg>
  ),
};

/* ─── Tab definitions ─── */
const TABS = [
  { id: 'machine',     label: 'Machine',    Icon: Icon.Machine,     fields: ['machineUsername'] },
  { id: 'api',         label: 'API & Auth', Icon: Icon.Api,         fields: ['authorization_token'] },
  { id: 'calibration', label: 'Calibration',Icon: Icon.Calibration, fields: ['calibrationWaybillNumber','calibrateLength','calibrateWidth','calibrateHeight','calibrateWeight','calibrateToleranceLength','calibrateToleranceWidth','calibrateToleranceHeight','calibrateToleranceWeight','countThreshold'] },
  { id: 'boxlimits',   label: 'Box Limits', Icon: Icon.Box,         fields: ['boxlengthMin','boxlengthMax','boxbreadthMin','boxbreadthMax','boxheightMin','boxheightMax','boxweightMin','boxweightMax'] },
  { id: 'regex',       label: 'Regex',      Icon: Icon.Regex,       fields: ['regexPattern'] },
];

const LABELS = {
  machineUsername:'Machine Username',
  calibrationWaybillNumber:'Calibration Waybill Number',
  authorization_token:'Authorization Bearer', countThreshold:'Count Threshold',
  calibrateLength:'Calibrate Length (mm)', calibrateWidth:'Calibrate Width (mm)', calibrateHeight:'Calibrate Height (mm)',
  calibrateWeight:'Calibrate Weight (gm)', calibrateToleranceLength:'Calibrate Tolerance Length (mm)',
  calibrateToleranceWidth:'Calibrate Tolerance Width (mm)', calibrateToleranceHeight:'Calibrate Tolerance Height (mm)',
  calibrateToleranceWeight:'Calibrate Tolerance Weight (gm)', boxlengthMin:'Box Length Min (mm)',
  boxlengthMax:'Box Length Max (mm)', boxbreadthMin:'Box Breadth Min (mm)', boxbreadthMax:'Box Breadth Max (mm)',
  boxheightMin:'Box Height Min (mm)', boxheightMax:'Box Height Max (mm)', boxweightMin:'Box Weight Min (gm)',
  boxweightMax:'Box Weight Max (gm)', regexPattern:'Regex Pattern',
};

const SENSITIVE = new Set(['authorization_token']);
const SUMMARY_FIELDS = ['machineUsername'];

// How often (ms) settings are auto-pushed to Node-RED
const AUTO_SEND_INTERVAL_MS = 1000;

const mask = (key, val) => {
  if (val == null || val === '') return null;
  const s = String(val);
  if (!SENSITIVE.has(key)) return s;
  return s.length > 4 ? `${'•'.repeat(Math.min(s.length - 4, 8))}${s.slice(-4)}` : '••••••••';
};

/* ─── Toast ─── */
const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 3200); return () => clearTimeout(t); }, [onClose]);
  const IconComp = type === 'success' ? Icon.Check : type === 'warning' ? Icon.Warning : Icon.Close;
  return (
    <div className={`sp-toast sp-toast--${type}`}>
      <IconComp />
      {message}
    </div>
  );
};

/* ─── Edit Modal ─── */
const EditModal = ({ fieldKey, label, currentValue, onClose, onSave }) => {
  const [value, setValue] = useState(currentValue ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSubmit = async () => {
    setSaving(true);
    await onSave(fieldKey, value);
    setSaving(false);
  };

  const isSensitive = SENSITIVE.has(fieldKey);
  const displayCurrent = mask(fieldKey, currentValue) ?? '— not set —';

  return (
    <div className="sp-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sp-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        {/* Header */}
        <div className="sp-modal-header">
          <div className="sp-modal-header-left">
            <div className="sp-modal-icon-wrap">
              <Icon.Edit />
            </div>
            <div>
              <div className="sp-modal-title" id="modal-title">Edit Setting</div>
              <div className="sp-modal-subtitle">{label}</div>
            </div>
          </div>
          <button className="sp-modal-close" onClick={onClose} aria-label="Close">
            <Icon.Close />
          </button>
        </div>

        {/* Body */}
        <div className="sp-modal-body">
          <div>
            <div className="sp-modal-section-label">Current value</div>
            <div className="sp-modal-current">{displayCurrent}</div>
          </div>
          <div>
            <div className="sp-modal-section-label">New value</div>
            <input
              ref={inputRef}
              className="sp-modal-input"
              type={isSensitive ? 'password' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Enter ${label.toLowerCase()}…`}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            <div className="sp-modal-hint">
              {isSensitive ? 'Sensitive field — value will be masked in the UI.' : 'Press Enter to save quickly.'}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sp-modal-footer">
          <button className="sp-modal-cancel" onClick={onClose}>Cancel</button>
          <button className="sp-modal-save" onClick={handleSubmit} disabled={saving}>
            {saving ? (
              <>Saving…</>
            ) : (
              <><Icon.Save />Save changes</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Main Component ─── */
const SettingsPage = () => {
  const [settings, setSettings] = useState({});
  const [activeTab, setActiveTab] = useState('machine');
  const [editField, setEditField] = useState(null);
  const [toasts, setToasts] = useState([]);

  // Always holds the latest settings so the 10s interval never sends stale data
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    axios.get('http://localhost:5001/api/settings/settings-data')
      .then((res) => setSettings(res.data))
      .catch((err) => console.error('❌ Failed to fetch settings:', err.message));
  }, []);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleSave = async (field, value) => {
    try {
      await axios.put('http://localhost:5001/api/settings/settings-update', { field, value });
      setSettings((prev) => ({ ...prev, [field]: value }));
      setEditField(null);
      addToast('Setting updated successfully', 'success');
    } catch (err) {
      console.error('❌ Failed to update:', err.message);
      addToast('Failed to update setting', 'danger');
    }
  };

  const handleDownload = async () => {
    try {
      const res = await axios.post(
        'http://localhost:1880/download-report',
        {
          value: true
        }
      );

      if (res.status === 200) {
        addToast('Tare Sent Success', 'success');
      } else {
        addToast('Node-RED did not acknowledge the request', 'warning');
      }
    } catch (err) {
      console.error('❌ Failed to send download request:', err.message);
      addToast('Failed to send download request', 'danger');
    }
  };

  // Sends the current settings to Node-RED.
  // silent = true suppresses toasts (used by the auto/interval sender so it
  // doesn't spam the UI every 10 seconds); manual button clicks still show toasts.
  const handleSendToNodeRed = useCallback(async (silent = false) => {
    try {
      const latestSettings = settingsRef.current;
      const payload = Object.entries(LABELS).reduce((acc, [k]) => {
        acc[k] = latestSettings[k] ?? '';
        return acc;
      }, {});
      const res = await axios.post('http://localhost:1880/settings-receive', payload);
      if (res.status === 200) {
        if (!silent) addToast('Sent to DWS Machine successfully', 'success');
        console.log('send');
      } else {
        if (!silent) addToast('DWS Machine did not acknowledge', 'warning');
        console.log('not sent');
      }
    } catch (err) {
      console.error('❌ Failed to send:', err.message);
      if (!silent) addToast('Failed to send to DWS Machine', 'danger');
    }
  }, [addToast]);

  // Auto-send settings to Node-RED every 10 seconds
  // useEffect(() => {
  //   const intervalId = setInterval(() => {
  //     handleSendToNodeRed(true); // silent = true, no toast spam every 10s
  //   }, AUTO_SEND_INTERVAL_MS);

  //   return () => clearInterval(intervalId);
  // }, [handleSendToNodeRed]);

  const currentTab = TABS.find((t) => t.id === activeTab);

  return (
    <div className="sp-page">
      {/* ── Header ── */}
      <div className="sp-header">
        <div>
          <div className="sp-breadcrumb">Configuration / Settings</div>
          <h1>Settings</h1>
          <div className="sp-header-sub">Manage DWS machine parameters and thresholds</div>
        </div>
        <div className="sp-header-actions">
          <button className="sp-btn sp-btn-ghost" onClick={handleDownload}>
            {/* <Icon.Download /> */}
            Tare Weight
          </button>
          <button className="sp-btn sp-btn-primary" onClick={() => handleSendToNodeRed(false)}>
            <Icon.Send />
            Send to DWS
          </button>
        </div>
      </div>

      {/* ── Summary Strip ── */}
      <div className="sp-summary">
        {SUMMARY_FIELDS.map((key) => {
          const display = mask(key, settings[key]);
          return (
            <div className="sp-sum-card" key={key}>
              <div className="sp-sum-label">{LABELS[key]}</div>
              <div className="sp-sum-value">{display ?? '—'}</div>
            </div>
          );
        })}
      </div>

      {/* ── Tabs ── */}
      <div className="sp-tabs" role="tablist">
        {TABS.map(({ id, label, Icon: TabIcon, fields }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            className={`sp-tab${activeTab === id ? ' sp-tab--active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            <TabIcon />
            <span className="sp-tab-label">{label}</span>
            <span className="sp-tab-badge">{fields.length}</span>
          </button>
        ))}
      </div>

      {/* ── Setting Cards ── */}
      <div className="sp-grid" role="tabpanel">
        {currentTab?.fields.map((key, i) => {
          const raw = settings[key];
          const display = mask(key, raw);
          const masked = SENSITIVE.has(key) && raw;
          return (
            <div
              className="sp-card"
              key={key}
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="sp-card-info">
                <div className="sp-card-label">{LABELS[key]}</div>
                <div className={`sp-card-value${!display ? ' sp-card-value--empty' : masked ? ' sp-card-value--masked' : ''}`}>
                  {display ?? 'Not configured'}
                </div>
              </div>
              <button
                className="sp-edit-btn"
                onClick={() => setEditField(key)}
                aria-label={`Edit ${LABELS[key]}`}
              >
                <Icon.Edit />
                Edit
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Edit Modal ── */}
      {editField && (
        <EditModal
          fieldKey={editField}
          label={LABELS[editField]}
          currentValue={settings[editField]}
          onClose={() => setEditField(null)}
          onSave={handleSave}
        />
      )}

      {/* ── Toasts ── */}
      <div className="sp-toasts">
        {toasts.map((t) => (
          <Toast
            key={t.id}
            message={t.message}
            type={t.type}
            onClose={() => removeToast(t.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default SettingsPage;
