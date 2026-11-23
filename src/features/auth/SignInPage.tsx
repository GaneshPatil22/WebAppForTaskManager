import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/auth';
import { Icon } from '../../ui/Icon';
import styles from './signin.module.css';

export function SignInPage() {
  const { auth } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await auth.sendMagicLink(email.trim()); setSent(true); } catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t send the link.'); } finally { setBusy(false); }
  };
  return (
    <div className={styles.wrap}>
      <div className={`card ${styles.card}`}>
        <div className={styles.logo}><i><Icon name="brain" size={20} /></i>Brain</div>
        <h1>Dump anything.</h1>
        <p className="sub">It organises it, finds what depends on what, and tells you the one thing to do next.</p>
        {sent ? (
          <div className="banner info" style={{ marginTop: 18 }}>Check {email} for a sign-in link.</div>
        ) : (
          <form onSubmit={submit} className={styles.form}>
            <label className="field"><span>Email</span>
              <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
            {error ? <div className="banner danger">{error}</div> : null}
          </form>
        )}
      </div>
    </div>
  );
}

export function ConfigErrorPage({ message }: { message: string }) {
  return (
    <div className={styles.wrap}>
      <div className={`card ${styles.card}`}>
        <h1>Brain isn’t configured</h1>
        <p className="sub" style={{ marginTop: 8 }}>{message}</p>
      </div>
    </div>
  );
}
