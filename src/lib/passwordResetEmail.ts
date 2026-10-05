interface PasswordResetEmailParams {
  appOrigin: string;
  displayName: string;
  email: string;
  resetUrl: string;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set. Configure Resend before sending password reset emails.");
  }
  return {
    apiKey,
    from: process.env.RESEND_FROM_EMAIL?.trim() || "WrazyOS <info@wrazyos.com>",
  };
}

/** The reset email a user receives after "Forgot password?". The link is the
 * Better Auth verification URL, so it must be delivered exactly as given. */
export async function sendPasswordResetEmail({ appOrigin, displayName, email, resetUrl }: PasswordResetEmailParams) {
  const { apiKey, from } = getResendConfig();
  const origin = appOrigin.replace(/\/$/, "");
  const logoUrl = `${origin}/icon.svg`;
  const safeName = escapeHtml(displayName || email);
  const safeResetUrl = escapeHtml(resetUrl);

  const subject = "Reset your WrazyOS password";
  const text = [
    `Hi ${displayName || email},`,
    "",
    "We received a request to reset your WrazyOS password.",
    "Use this link to choose a new one (it expires in one hour):",
    resetUrl,
    "",
    "If you didn't request this, you can ignore this email — your password stays unchanged.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0c0f;color:#e8e9ec;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c0f;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#14161b;border:1px solid #23252b;border-radius:16px;padding:32px;">
            <tr>
              <td style="padding-bottom:20px;">
                <img src="${logoUrl}" width="32" height="32" alt="WrazyOS" style="display:block;border-radius:8px;" />
              </td>
            </tr>
            <tr>
              <td style="font-size:20px;font-weight:700;padding-bottom:8px;">Reset your password</td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:22px;color:#9a9da6;padding-bottom:24px;">
                Hi ${safeName}, we received a request to reset your WrazyOS password.
                Choose a new one with the button below. The link expires in one hour.
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${safeResetUrl}" style="display:inline-block;background:#4f7cff;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:10px;">
                  Choose a new password
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:20px;color:#6d7078;padding-bottom:8px;">
                Or paste this link into your browser:<br />
                <a href="${safeResetUrl}" style="color:#8ab4ff;word-break:break-all;">${safeResetUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:20px;color:#6d7078;">
                If you didn't request this, you can ignore this email — your password stays unchanged.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // A slow provider must never leave a dangling background request.
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      html,
      text,
    }),
  });

  const payload = (await res.json().catch(() => null)) as {
    id?: string;
    message?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    throw new Error(payload?.error?.message || payload?.message || "Failed to send password reset email.");
  }

  return { id: payload?.id ?? null };
}
