import { redirect } from 'next/navigation';

/**
 * Root entry point — the dashboard shell lives under `(dashboard)`.
 * `src/middleware.ts` sends unauthenticated visitors to `/login`.
 */
export default function HomePage() {
  redirect('/overview');
}
