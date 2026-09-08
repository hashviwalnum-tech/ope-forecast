/**
 * Addresses the phone needs to send someone to, as opposed to call itself.
 *
 * The API base lives in `api/client.ts`; this is the other one — the web app,
 * which is where a password-recovery link has to land. A recovery link cannot
 * usefully come back to the phone: catching one would mean registering a URL
 * scheme with both stores and a development build to test it on, which is a lot
 * of moving parts for a screen someone sees once and may never see again. So
 * the phone asks for the link, the link opens the web app in a browser, the new
 * password is set there, and they come back here and sign in. The wording on
 * the login screen says exactly that, so nobody is left wondering.
 */
export const WEB_APP_URL =
  process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://ope-forecast-bngx.vercel.app'
