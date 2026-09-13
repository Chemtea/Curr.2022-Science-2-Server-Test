(() => {
  'use strict';
  const projectRef = 'rerykeslgwhamreoskgx';
  const baseUrl = `https://${projectRef}.supabase.co`;
  const namespace = `science-platform-test:${projectRef}:`;
  const scopedStorage = (store) => Object.freeze({
    getItem: key => store.getItem(namespace + String(key)),
    setItem: (key, value) => store.setItem(namespace + String(key), String(value)),
    removeItem: key => store.removeItem(namespace + String(key)),
    clear: () => {
      const keys = Array.from({length: store.length}, (_, i) => store.key(i));
      keys.filter(key => key && key.startsWith(namespace)).forEach(key => store.removeItem(key));
    },
    key: index => Array.from({length: store.length}, (_, i) => store.key(i))
      .filter(key => key && key.startsWith(namespace))[index]?.slice(namespace.length) ?? null,
    get length() { return Array.from({length: store.length}, (_, i) => store.key(i))
      .filter(key => key && key.startsWith(namespace)).length; }
  });
  Object.defineProperty(window, 'platformSessionStorage', {value: scopedStorage(window.sessionStorage)});
  Object.defineProperty(window, 'platformLocalStorage', {value: scopedStorage(window.localStorage)});
  const config = {environment: 'test', projectRef, baseUrl, SESSION_NAMESPACE: namespace,
    // Custom-session APIs do not need a browser service key. Never use the production key.
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_gj5c2milVlOVAPnPNaQAgg_omeaIJhs', REALTIME_LOCK_TOPIC: 'science-platform-locks',
    PLATFORM_BUILD: '2026-09-13-common-engine.3'};
  for (const name of ['platform', 'point', 'question', 'announcement', 'account',
    'submission', 'academic-year', 'lock-realtime', 'content', 'activation', 'assessment']) {
    const key = name === 'lock-realtime' ? 'LOCK_API' : name.toUpperCase().replaceAll('-', '_') + '_API';
    config[key] = `${baseUrl}/functions/v1/${name}-api`;
  }
  Object.defineProperty(window, 'PLATFORM_CONFIG', {value: Object.freeze(config)});
})();
