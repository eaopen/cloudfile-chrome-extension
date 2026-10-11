const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBackground(options = {}) {
  let external, internal, alarm, clickNotification;
  const nativeCalls = [];
  const store = {};
  const chrome = {
    runtime: {
      onMessageExternal: { addListener(fn) { external = fn; } },
      onMessage: { addListener(fn) { internal = fn; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getManifest: () => ({ version: '1.0.1' }),
      sendNativeMessage: async (host, message) => {
        nativeCalls.push({ host, message });
        if (typeof options.native === 'function') return options.native(host, message);
        if (host === 'com.cloudfile.agent2') throw new Error('Agent2 host not installed');
        if (host === 'com.cloudfile.current_agent' && options.currentHostMissing) throw new Error('Windows host not installed');
        if (message.type === 'status') return { ok: true, version: '1.0.1' };
        return { ok: true };
      },
      reload() {},
      openOptionsPage: async () => {},
    },
    alarms: {
      get: async () => null,
      create() {},
      clear: async () => {},
      onAlarm: { addListener(fn) { alarm = fn; } },
    },
    notifications: {
      onClicked: { addListener(fn) { clickNotification = fn; } },
      create: async () => 'cloudfile-update',
      clear: async () => true,
    },
    storage: {
      local: {
        async get(names) {
          if (typeof names === 'string') return { [names]: store[names] };
          if (Array.isArray(names)) return Object.fromEntries(names.map(name => [name, store[name]]));
          return { ...store };
        },
        async set(values) { Object.assign(store, values); },
        async remove(names) { for (const name of Array.isArray(names) ? names : [names]) delete store[name]; },
      },
    },
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
      openPopup: async () => {},
    },
    tabs: { create: async () => {}, query: async () => [] },
  };
  const context = { chrome, URL, fetch: async () => ({ ok: false }), setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
  return {
    external: (...args) => external(...args),
    internal: (...args) => internal(...args),
    sendExternal(message, sender = { url: 'https://etech.example/file' }) {
      return new Promise(resolve => external(message, sender, resolve));
    },
    sendInternal(message) {
      return new Promise(resolve => internal(message, {}, resolve));
    },
    triggerAlarm(name) { if (alarm) alarm({ name }); },
    clickNotification(id) { if (clickNotification) clickNotification(id); },
    store, nativeCalls, chrome,
  };
}
function settle() { return new Promise(resolve => setImmediate(resolve)); }
module.exports = { loadBackground, settle };
