import axios from 'axios';

export const sendSettingsToNodeRed = async (settings) => {
  try {
    const payload = Object.entries(settings).reduce((acc, [key, val]) => {
      acc[key] = val ?? '';
      return acc;
    }, {});
    await axios.post('http://localhost:1880/settings-receive', payload);
    console.log("✅ Settings sent to Node-RED.");
  } catch (err) {
    console.error("❌ Failed to send settings to Node-RED:", err.message);
  }
};
