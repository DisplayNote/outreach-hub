import { signOut } from '@/lib/auth/config';

// Sign-out endpoint kept at the existing path so the sidebar form (POST
// /auth/signout) is unchanged. `redirect: false` clears the session cookie
// without relying on Auth.js's internal redirect throw; the handler then
// returns an explicit 303 redirect so Next.js sees a valid Response.
export async function POST(request: Request): Promise<Response> {
  await signOut({ redirect: false });
  return Response.redirect(new URL('/login', request.url), 303);
}
