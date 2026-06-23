import { signOut } from '@/lib/auth/config';

// Sign-out endpoint kept at the existing path so the sidebar form (POST
// /auth/signout) is unchanged. Auth.js `signOut` clears the session cookie and
// redirects to /login.
export async function POST() {
  await signOut({ redirectTo: '/login' });
}
