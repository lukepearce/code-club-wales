import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { authClient } from './lib/auth-client';
import { requestJoin } from './lib/api';

/**
 * /join — request a Crew account. Username + password (+ optional email). The
 * request is inert: it creates a PENDING crew_member and mints no session, so a
 * successful submit tells the visitor they must wait for the Organiser.
 */
export function JoinPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const join = useMutation({ mutationFn: requestJoin });
  const result = join.data;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    join.mutate({ username, password, email: email.trim() || undefined });
  }

  if (result?.ok) {
    return (
      <section>
        <h1>Request received</h1>
        <p>
          Thanks, <strong>{result.username}</strong>. Your request is waiting for the Organiser to
          admit you. Once admitted, you can sign in with your username and password.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>Request to join</h1>
      <p>Pick a username and password. Email is optional.</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Email (optional)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        {result && !result.ok && (
          <div className="form-error" role="alert">
            {result.reasons && result.reasons.length > 0 ? (
              <ul>
                {result.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p>{result.message ?? 'Something went wrong. Please try again.'}</p>
            )}
          </div>
        )}

        <button type="submit" disabled={join.isPending}>
          {join.isPending ? 'Sending…' : 'Request account'}
        </button>
      </form>
    </section>
  );
}

/**
 * /signin — username + password. The Admission gate refuses pending members, so
 * a pending sign-in surfaces the friendly "waiting to be admitted" message here.
 */
export function SignInPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error: signInError } = await authClient.signIn.username({ username, password });
    setPending(false);
    if (signInError) {
      setError(signInError.message ?? 'Could not sign in. Check your details.');
      return;
    }
    await navigate({ to: '/' });
  }

  return (
    <section>
      <h1>Sign in</h1>
      <form className="stack" onSubmit={onSubmit}>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            <p>{error}</p>
          </div>
        )}
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  );
}

/**
 * / — the gated dashboard. Reachable only with a session (the route guard
 * redirects to /signin otherwise). Lessons + the AI coach land here in later
 * slices.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { data } = authClient.useSession();
  const who = data?.user.displayUsername ?? data?.user.username ?? data?.user.name;

  async function onSignOut() {
    await authClient.signOut();
    await navigate({ to: '/signin' });
  }

  return (
    <section>
      <h1>Welcome{who ? `, ${who}` : ''}</h1>
      <p>You are admitted and signed in. Lessons and the AI coach will appear here.</p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </section>
  );
}
