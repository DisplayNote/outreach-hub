// Explicit, stable Supabase auth cookie name shared by the browser, server, and
// middleware clients.
//
// @supabase/ssr otherwise derives the cookie/storage key from the Supabase URL
// host (`sb-<host>-auth-token`). In the Docker dev path the browser connects to
// `localhost` while the server/middleware connect to `host.docker.internal`, so
// the derived names would differ and the server could not read the PKCE/session
// cookie the browser wrote. Pinning one name keeps the network URL free to
// differ per runtime while the auth cookie stays consistent.
export const SUPABASE_AUTH_COOKIE_NAME = 'sb-outreach-auth';
