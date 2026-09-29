// Product name shown in the app. Set VITE_APP_NAME at build time to rename a build
// (e.g. the AriaPay preview on Vercel); Node scripts such as check:strings get the default.
export const BRAND = import.meta.env?.VITE_APP_NAME || 'AriaPay'
