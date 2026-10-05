"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** Better Auth's reset link verifies the token and redirects here with
 * `?token=…`; the token is single-use and expires after an hour. */
function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password, token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "This reset link is invalid or has expired. Request a new one.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <>
        <h1 style={{ fontSize: 20, margin: 0, color: "#e8e9ec" }}>Reset link needed</h1>
        <p style={{ margin: 0, fontSize: 13, lineHeight: "20px", color: "#9a9da6" }}>
          This page needs the link from your reset email. Request a new one and open it here.
        </p>
        <Link href="/forgot-password" style={{ fontSize: 13, color: "#8ab4ff", textAlign: "center", textDecoration: "none" }}>
          Send a new reset link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <h1 style={{ fontSize: 20, margin: 0, color: "#e8e9ec" }}>Password updated</h1>
        <p style={{ margin: 0, fontSize: 13, lineHeight: "20px", color: "#9a9da6" }}>
          Your password has been changed. Sign in with it now.
        </p>
        <Link href="/login" style={{ fontSize: 13, color: "#8ab4ff", textAlign: "center", textDecoration: "none" }}>
          Back to sign in
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ fontSize: 20, margin: 0, color: "#e8e9ec" }}>Choose a new password</h1>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        New password
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          style={inputStyle}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        Confirm new password
        <input
          type="password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          style={inputStyle}
        />
      </label>
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "#f28b82" }}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !password || !confirm}
        style={{
          marginTop: 4,
          padding: "10px 16px",
          borderRadius: 10,
          border: "none",
          background: busy || !password || !confirm ? "#3a3d46" : "#4f7cff",
          color: "#fff",
          fontWeight: 600,
          cursor: busy || !password || !confirm ? "default" : "pointer",
        }}
      >
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
        background: "#0b0c0f",
        color: "#e8e9ec",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          width: "min(360px, calc(100vw - 48px))",
          padding: 32,
          borderRadius: 16,
          border: "1px solid #23252b",
          background: "#14161b",
        }}
      >
        <Suspense fallback={<p style={{ margin: 0, fontSize: 13, color: "#9a9da6" }}>Loading reset link…</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #2a2d35",
  background: "#0b0c0f",
  color: "#e8e9ec",
  fontSize: 14,
};
