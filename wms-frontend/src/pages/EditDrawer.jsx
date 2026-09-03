import React, { useState, useEffect } from 'react';
import '../styles/EditDrawer.css';

const EditDrawer = ({ field, label, value, onClose, onSave }) => {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');

  const fixedTimeOptions = [
    "00:00", "01:00", "02:00", "03:00", "04:00", "05:00",
    "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
    "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
    "18:00", "19:00", "20:00", "21:00", "22:00", "23:00"
  ];

  useEffect(() => {
    setInputValue(value !== undefined && value !== null ? value.toString() : '');
    setError('');
  }, [value]);

  const handleSubmit = () => {
    if (inputValue === '') return;

    const isNumberField = typeof value === 'number';
    const parsedValue = isNumberField ? Number(inputValue) : inputValue;

    if (isNumberField && parsedValue < 0) {
      setError('Value cannot be negative.');
      return;
    }

    onSave(field, parsedValue);
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h5>Edit {label}</h5>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="drawer-body">
          <label className="form-label">{label}</label>

          {field === 'fixedTime' ? (
            <select
              className="form-control"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            >
              <option value="">-- Select Time --</option>
              {fixedTimeOptions.map((time) => (
                <option key={time} value={time}>{time}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                type={typeof value === 'number' ? 'number' : 'text'}
                className="form-control"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setError('');
                }}
              />
              {error && <small className="text-danger mt-1 d-block">{error}</small>}
            </>
          )}
        </div>

        <div className="drawer-footer">
          <button className="btn btn-secondary me-2" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>Save</button>
        </div>
      </div>
    </div>
  );
};

export default EditDrawer;
