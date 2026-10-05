"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "Could not send the reset link. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

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
        <h1 style={{ fontSize: 20, margin: 0 }}>Reset your password</h1>
        {sent ? (
          <>
            <p style={{ margin: 0, fontSize: 13, lineHeight: "20px", color: "#9a9da6" }}>
              If an account exists for <strong style={{ color: "#e8e9ec" }}>{email}</strong>, we&apos;ve sent a
              link to choose a new password. It expires in one hour.
            </p>
            <Link href="/login" style={{ fontSize: 13, color: "#8ab4ff", textAlign: "center", textDecoration: "none" }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: "20px", color: "#9a9da6" }}>
              Enter the email for your WrazyOS account and we&apos;ll send a reset link.
            </p>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
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
              disabled={busy}
              style={{
                marginTop: 4,
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background: busy ? "#3a3d46" : "#4f7cff",
                color: "#fff",
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <Link href="/login" style={{ fontSize: 13, color: "#8ab4ff", textAlign: "center", textDecoration: "none" }}>
              Back to sign in
            </Link>
          </form>
        )}
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
