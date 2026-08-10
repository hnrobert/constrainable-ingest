/**
 * HTML email body for the registration verification code. Self-contained inline
 * styles (mail clients strip <style>); works in both light and dark clients.
 */

/** A large, copy-friendly verification code email. */
export function renderVerificationEmail(code: string, minutes: number): string {
  return `<!doctype html>
<html lang="zh-CN"><body>
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1f2937;">
  <h2 style="margin:0 0 8px;font-size:18px;">监考收流平台 · 注册验证码</h2>
  <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">你正在注册账号，请使用下面的验证码完成验证：</p>
  <div style="text-align:center;background:#f3f4f6;border:1px dashed #d1d5db;border-radius:10px;padding:20px;margin:0 0 20px;">
    <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#111827;">${code}</span>
  </div>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">验证码 ${minutes} 分钟内有效。如果不是你本人操作，请忽略此邮件。</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
  <p style="margin:0;color:#9ca3af;font-size:12px;">此邮件由系统自动发送，请勿回复。</p>
</div>
</body></html>`
}

export const VERIFICATION_CODE_SUBJECT = '【监考收流平台】注册验证码'
