"use client";

import { useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
      <form
        onSubmit={handleSubmit}
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
        <h1 style={{ fontSize: 20, margin: 0 }}>WrazyOS</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#9a9da6" }}>
          Sign in to continue. Accounts are invite-only.
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
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
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
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <Link
          href="/forgot-password"
          style={{ fontSize: 13, color: "#8ab4ff", textAlign: "center", textDecoration: "none" }}
        >
          Forgot password?
        </Link>
      </form>
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
