/**
 * HTML email body for the registration verification code. Self-contained inline
 * styles (mail clients strip <style>); works in both light and dark clients.
 */

/** A large, copy-friendly verification code email. */
export function renderVerificationEmail(code: string, minutes: number): string {
  return `<!doctype html>
<html lang="en"><body>
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1f2937;">
  <h2 style="margin:0 0 8px;font-size:18px;">Constrainable Ingest · Registration verification code</h2>
  <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">You are registering an account. Please use the verification code below to complete verification:</p>
  <div style="text-align:center;background:#f3f4f6;border:1px dashed #d1d5db;border-radius:10px;padding:20px;margin:0 0 20px;">
    <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#111827;">${code}</span>
  </div>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">The code is valid for ${minutes} minutes. If this wasn't you, please ignore this email.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
  <p style="margin:0;color:#9ca3af;font-size:12px;">This email was sent automatically; please do not reply.</p>
</div>
</body></html>`
}

export const VERIFICATION_CODE_SUBJECT = '[Constrainable Ingest]Registration verification code'
