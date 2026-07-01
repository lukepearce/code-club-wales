import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { authClient, signInWithGoogle } from './lib/auth-client';
import {
  admitMember,
  allowMemberReset,
  completeGoogleUsername,
  fetchOrganiserMembers,
  ORGANISER_MEMBERS_QUERY_KEY,
  OrganiserForbiddenError,
  rejectMember,
  requestJoin,
  requestPasswordReset,
  type OrganiserMember,
} from './lib/api';
import { Turnstile } from './lib/turnstile';

/**
 * "Continue with Google" — shared by the sign-in and join surfaces. One button
 * for both: an admitted, Google-linked member is signed in in one step; an
 * unknown identity is routed (via the API callback) to /welcome to pick a
 * username and wait for Admission.
 */
function GoogleButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  async function onClick() {
    setPending(true);
    try {
      await signInWithGoogle();
    } catch {
      // signIn.social redirects the browser; reaching here means it could not
      // start. Re-enable so the visitor can retry.
      setPending(false);
    }
  }
  return (
    <button type="button" className="google-button" onClick={onClick} disabled={pending}>
      {pending ? 'Redirecting…' : label}
    </button>
  );
}

/**
 * /join — request a Crew account. Username + password (+ optional email). The
 * request is inert: it creates a PENDING crew_member and mints no session, so a
 * successful submit tells the visitor they must wait for the Organiser.
 */
export function JoinPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  // The Turnstile widget fills this in once the visitor passes the bot check.
  const [turnstileToken, setTurnstileToken] = useState('');
  const join = useMutation({ mutationFn: requestJoin });
  const result = join.data;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    join.mutate({ username, password, email: email.trim() || undefined, turnstileToken });
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

        {/* Bot check. Must be solved before the request can be sent. */}
        <Turnstile onToken={setTurnstileToken} onError={() => setTurnstileToken('')} />

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

        <button type="submit" disabled={join.isPending || turnstileToken === ''}>
          {join.isPending ? 'Sending…' : 'Request account'}
        </button>
      </form>

      <div className="auth-divider">or</div>
      <GoogleButton label="Continue with Google" />
      <p className="auth-note">
        Joining with Google still needs the Organiser to admit you before you can sign in.
      </p>
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

      <div className="auth-divider">or</div>
      <GoogleButton label="Sign in with Google" />
    </section>
  );
}

/**
 * /welcome — the Google pick-a-username completion step. An unknown Google
 * identity lands here (the API callback redirects after the Admission gate
 * refuses a session): they are a PENDING crew_member with no username yet. They
 * choose a username; the account stays pending until the Organiser admits them.
 *
 * The pending user's id arrives as `?uid=` on the redirect. The real Google
 * OAuth client + the exact post-OAuth redirect carrying that id is a human
 * handoff item; without it we explain that the Google sign-in must be retried.
 */
export function GoogleWelcomePage() {
  const navigate = useNavigate();
  const [params] = useState(() =>
    typeof window === 'undefined'
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search),
  );
  const userId = params.get('uid') ?? '';
  const [username, setUsername] = useState('');
  const complete = useMutation({
    mutationFn: () => completeGoogleUsername({ userId, username }),
  });
  const result = complete.data;

  if (result?.ok) {
    return (
      <section>
        <h1>Almost there, {result.username}</h1>
        {result.admitted ? (
          <>
            <p>Your account is ready. You can sign in with Google now.</p>
            <button type="button" onClick={() => void navigate({ to: '/signin' })}>
              Go to sign in
            </button>
          </>
        ) : (
          <p>
            Your username is saved. Your request is now waiting for the Organiser to admit you.
            Once admitted, sign in with Google in one click.
          </p>
        )}
      </section>
    );
  }

  if (!userId) {
    return (
      <section>
        <h1>Finish signing in with Google</h1>
        <p>
          We could not link your Google sign-in. Please head back and try “Continue with Google”
          again.
        </p>
        <button type="button" onClick={() => void navigate({ to: '/join' })}>
          Back to join
        </button>
      </section>
    );
  }

  return (
    <section>
      <h1>Pick a username</h1>
      <p>Thanks for signing in with Google. Choose a username to finish requesting your account.</p>
      <form
        className="stack"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          complete.mutate();
        }}
      >
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
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
              <p>{result.message ?? 'Could not save your username. Please try again.'}</p>
            )}
          </div>
        )}
        <button type="submit" disabled={complete.isPending}>
          {complete.isPending ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </section>
  );
}

/**
 * /reset — public, email-free password reset, keyed by username. A SIGNED-OUT
 * member sets their OWN new password here. It only works while the Organiser has
 * opened a reset window (the API enforces the 5-minute gate); outside a window
 * the API refuses and we show the "ask the Organiser" message it returns. No
 * email link is ever sent, and the Organiser never sees or sets the password.
 */
export function ResetPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const reset = useMutation({ mutationFn: requestPasswordReset });
  const result = reset.data;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    reset.mutate({ username: username.trim(), newPassword });
  }

  if (result?.ok) {
    return (
      <section>
        <h1>Password updated</h1>
        <p>Your new password is set. You can sign in with it now.</p>
        <button type="button" onClick={() => void navigate({ to: '/signin' })}>
          Go to sign in
        </button>
      </section>
    );
  }

  return (
    <section>
      <h1>Reset your password</h1>
      <p>
        Ask the Organiser to allow a reset for you. Then, within 5 minutes, set a new password
        below.
      </p>
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
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {result && !result.ok && (
          <div className="form-error" role="alert">
            <p>{result.message ?? 'Could not reset your password. Please try again.'}</p>
          </div>
        )}
        <button type="submit" disabled={reset.isPending}>
          {reset.isPending ? 'Saving…' : 'Set new password'}
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

function memberLabel(member: OrganiserMember): string {
  return member.displayUsername ?? member.username ?? member.displayName;
}

/** Is a reset window currently open for this member (a future closing instant)? */
function resetWindowOpen(member: OrganiserMember): boolean {
  return (
    member.resetAllowedUntil !== null && new Date(member.resetAllowedUntil).getTime() > Date.now()
  );
}

/**
 * /organiser — the Organiser area. Lists the pending queue and the active
 * members, with admit/reject controls. The route's beforeLoad redirects any
 * non-Organiser away; should one still reach here (e.g. a transient), the API
 * answers 403 and we render an "Organisers only" panel instead of controls.
 */
export function OrganiserPage() {
  const queryClient = useQueryClient();
  const membersQuery = useQuery({
    queryKey: ORGANISER_MEMBERS_QUERY_KEY,
    queryFn: fetchOrganiserMembers,
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ORGANISER_MEMBERS_QUERY_KEY });
  const admit = useMutation({ mutationFn: admitMember, onSuccess: refresh });
  const reject = useMutation({ mutationFn: rejectMember, onSuccess: refresh });
  const allowReset = useMutation({ mutationFn: allowMemberReset, onSuccess: refresh });
  const busy = admit.isPending || reject.isPending || allowReset.isPending;

  if (membersQuery.isPending) {
    return (
      <section>
        <h1>Organiser</h1>
        <p>Loading members…</p>
      </section>
    );
  }

  if (membersQuery.error) {
    if (membersQuery.error instanceof OrganiserForbiddenError) {
      return (
        <section>
          <h1>Organiser</h1>
          <p>This area is for Organisers only.</p>
        </section>
      );
    }
    return (
      <section>
        <h1>Organiser</h1>
        <p>Could not load members. Please try again.</p>
      </section>
    );
  }

  const members = membersQuery.data;
  const pending = members.filter((m) => m.status === 'pending');
  const active = members.filter((m) => m.status === 'active');
  const actionError = admit.error ?? reject.error ?? allowReset.error;

  return (
    <section className="organiser">
      <h1>Organiser</h1>
      <p>
        Admit people who have requested to join, reject a request to free the username, or allow a
        member a 5-minute window to set a new password.
      </p>

      {actionError && (
        <div className="form-error" role="alert">
          <p>{actionError.message}</p>
        </div>
      )}

      <h2>Pending requests ({pending.length})</h2>
      {pending.length === 0 ? (
        <p>No one is waiting to be admitted.</p>
      ) : (
        <ul className="member-list">
          {pending.map((member) => (
            <li key={member.userId} className="member-row">
              <span className="member-name">
                <strong>{memberLabel(member)}</strong>
              </span>
              <div className="member-actions">
                <button type="button" disabled={busy} onClick={() => admit.mutate(member.userId)}>
                  Admit
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => reject.mutate(member.userId)}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2>Active members ({active.length})</h2>
      {active.length === 0 ? (
        <p>No active members yet.</p>
      ) : (
        <ul className="member-list">
          {active.map((member) => (
            <li key={member.userId} className="member-row">
              <span className="member-name">
                <strong>{memberLabel(member)}</strong>
                {member.isOrganiser && <span className="badge">Organiser</span>}
                {resetWindowOpen(member) && <span className="badge">Reset window open</span>}
              </span>
              <div className="member-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => allowReset.mutate(member.userId)}
                >
                  Allow reset
                </button>
                {!member.isOrganiser && (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => reject.mutate(member.userId)}
                  >
                    Reject
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
