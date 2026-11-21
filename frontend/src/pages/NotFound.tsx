import { Link } from 'react-router-dom';

/** Branded 404 (skill B10): the same black and white glass card as
 *  the rest of the app, with a calm message and a way back. Unknown
 *  routes render this instead of bouncing to the dashboard. */
export function NotFoundPage() {
  return (
    <div className="auth-bg flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md px-6 py-10 text-center">
        <p className="heading-3" aria-hidden>
          404
        </p>
        <h1 className="heading-5 mt-2">Page not found</h1>
        <p className="body-6 mt-2" style={{ color: 'var(--muted)' }}>
          This page does not exist or was moved.
        </p>
        <Link to="/" className="btn btn-primary mt-6">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
