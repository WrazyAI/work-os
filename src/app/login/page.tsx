"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, ListTodo, LockKeyhole, Waypoints } from "lucide-react";
import styles from "./login.module.css";

function Wordmark() {
  return <Link href="/" aria-label="WrazyOS home" className={styles.brand}>
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7.5" fill="#1b1c1f" /><polyline points="7.5,11 11.25,21.5 16,14.5 20.75,21.5 24.5,11" fill="none" stroke="#4fd1a8" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span>WrazyOS<span className={styles.brandDot}>.</span></span>
  </Link>;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    let navigating = false;
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "Invalid email or password.");
        return;
      }
      window.location.href = "/work-os";
      navigating = true;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      if (!navigating) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }

  return <main className={styles.page}>
    <aside className={styles.story} aria-label="A clearer way to work">
      <Wordmark />
      <div className={styles.storyBody}>
        <p className={styles.eyebrow}><span aria-hidden="true" /> A clearer way to work</p>
        <h2>A little less noise.<br />A lot more focus.</h2>
        <p className={styles.storyDescription}>Your plans, people, and AI.<br />Together in a workspace that makes sense.</p>
        <div className={styles.rhythm} aria-label="The WrazyOS work rhythm">
          <div className={styles.rhythmHeading}><Waypoints size={18} aria-hidden="true" /><span>A little direction goes a long way.</span></div>
          <ol>
            <li><span className={styles.rhythmIcon}><ListTodo size={18} aria-hidden="true" /></span><div><strong>Make a plan.</strong><span>Give the day a clear direction.</span></div><span className={styles.step}>01</span></li>
            <li><span className={styles.rhythmIcon}><Waypoints size={18} aria-hidden="true" /></span><div><strong>Do the work.</strong><span>Keep the context close.</span></div><span className={styles.step}>02</span></li>
            <li><span className={styles.rhythmIcon}><Check size={18} aria-hidden="true" /></span><div><strong>Close the loop.</strong><span>Review, reflect, move forward.</span></div><span className={styles.step}>03</span></li>
          </ol>
        </div>
      </div>
      <p className={styles.storyFooter}>Less keeping up. More following through.</p>
    </aside>

    <section className={styles.signInPanel} aria-labelledby="login-title">
      <div className={styles.topbar}><div className={styles.mobileBrand}><Wordmark /></div><Link href="/" className={styles.back}><ArrowLeft size={15} aria-hidden="true" /> Back to home</Link></div>
      <div className={styles.formStage}>
        <div className={styles.formContent}>
          <span className={styles.formMark} aria-hidden="true"><LockKeyhole size={22} strokeWidth={1.6} /></span>
          <h1 id="login-title">Welcome back.</h1>
          <p className={styles.intro}>A fresh start, right where you left off.<br />Sign in to your WrazyOS workspace.</p>
          <form method="post" action="/api/auth/sign-in/email" onSubmit={handleSubmit} aria-label="Sign in to WrazyOS" aria-busy={busy}>
            <noscript><p className={styles.error}>Enable JavaScript and reload this page to sign in.</p></noscript>
            <div className={styles.field}>
              <label htmlFor="login-email">Email</label>
              <input id="login-email" name="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" spellCheck={false} autoCapitalize="none" readOnly={busy} />
            </div>
            <div className={styles.field}>
              <div className={styles.passwordLabel}><label htmlFor="login-password">Password</label><Link href="/forgot-password">Forgot password?</Link></div>
              <div className={styles.passwordField}>
                <input id="login-password" name="password" type={showPassword ? "text" : "password"} required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" readOnly={busy} />
                <button type="button" className={styles.reveal} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} aria-controls="login-password" onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
              </div>
            </div>
            {error ? <p role="alert" className={styles.error}>{error}</p> : null}
            <button type="submit" disabled={busy} className={styles.submit}>{busy ? "Signing in…" : "Sign in"}<ArrowRight size={17} aria-hidden="true" /></button>
            <span role="status" className={styles.srOnly}>{busy ? "Signing in to your workspace." : ""}</span>
          </form>
          <div className={styles.invitation}><span className={styles.invitationDot} aria-hidden="true" /><p>Accounts are invitation only.<br /><span>New to WrazyOS? Ask your workspace administrator.</span></p></div>
        </div>
      </div>
      <footer className={styles.footer}><span>© {new Date().getFullYear()} WrazyAI, LLC</span><nav aria-label="Legal and support"><Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms of Service</Link><a href="mailto:info@wrazyos.com">Contact</a></nav></footer>
    </section>
  </main>;
}
