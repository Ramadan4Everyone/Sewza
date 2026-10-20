/* SEWZA Supabase client bridge. */
(function () {
  'use strict';
  const config = window.SEWZA_SUPABASE_CONFIG;
  if (!config || !config.url || !config.anonKey) {
    console.warn('SEWZA: Supabase configuration is missing.');
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('SEWZA: Supabase JS client failed to load.');
    return;
  }
  try {
    window.SEWZA_SUPABASE = window.SEWZA_SUPABASE || {};
    window.SEWZA_SUPABASE.client = window.supabase.createClient(
      config.url.replace(/\/$/, ''),
      config.anonKey
    );
    window.SEWZA_SUPABASE.isReady = true;
    console.info('SEWZA: Supabase client ready.');
  } catch (error) {
    console.error('SEWZA: Could not initialize Supabase.', error);
  }
})();
