import nodemailer from 'nodemailer';
import { env } from '../config/env';

/**
 * Real transport when SMTP_HOST is configured; otherwise emails are console-logged
 * (with the link/code the real email would contain) so local dev works with zero setup.
 */
const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

const logEmail = (to: string, subject: string, link: string): void => {
  console.log(
    `\n[email] To: ${to}\n[email] Subject: ${subject}\n[email] Link: ${link}\n`,
  );
};

const send = async (
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<void> => {
  if (!transporter) return;
  try {
    await transporter.sendMail({ from: env.SMTP_FROM, to, subject, text, html });
  } catch (err) {
    // Sending is fire-and-forget from callers' perspective (token/code is already
    // persisted), so a delivery failure must not crash the request — just surface it.
    console.error(`[email] Failed to send "${subject}" to ${to}:`, err);
  }
};

const verificationCodeHtml = (code: string): string => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;800&display=swap');
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#EF9A54; font-family:'Unbounded', Verdana, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EF9A54;">
      <tr>
        <td align="center" style="padding: 48px 16px;">
          <table role="presentation" width="100%" style="max-width:480px;" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding-bottom: 24px;">
                <div style="font-family:'Unbounded', Verdana, Arial, sans-serif; font-size:22px; font-weight:600; color:#ffffff; letter-spacing:0.5px;">
                  Verify your email
                </div>
              </td>
            </tr>
            <tr>
              <td align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:24px; box-shadow:0 12px 32px rgba(0,0,0,0.18);">
                  <tr>
                    <td align="center" style="padding: 40px 32px;">
                      <div style="font-family:'Unbounded', Verdana, Arial, sans-serif; font-size:16px; color:#8a5a33; margin-bottom:16px;">
                        Your verification code
                      </div>
                      <div style="font-family:'Unbounded', Verdana, Arial, sans-serif; font-size:64px; font-weight:800; color:#EF9A54; letter-spacing:12px; line-height:1.1;">
                        ${code}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top: 28px;">
                <div style="font-family:'Unbounded', Verdana, Arial, sans-serif; font-size:13px; color:#fff2e6;">
                  This code will expire soon. If you didn't request it, ignore this email.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

export const sendVerificationEmail = async (
  to: string,
  token: string,
  code: string,
): Promise<void> => {
  const link = `${env.APP_BASE_URL}/api/auth/email/verify?token=${token}`;
  logEmail(to, 'Verify your email', link);
  console.log(`[email] Code: ${code}\n`);
  await send(
    to,
    'Verify your email',
    `Verify your email by opening this link:\n${link}\n\nOr enter this code in the app: ${code}\n\nThis link/code will expire soon.`,
    verificationCodeHtml(code),
  );
};

const statusNoticeHtml = (title: string, message: string, accentColor: string): string => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;800&display=swap');
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:${accentColor}; font-family:'Unbounded', Verdana, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${accentColor};">
      <tr>
        <td align="center" style="padding: 48px 16px;">
          <table role="presentation" width="100%" style="max-width:480px;" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding-bottom: 24px;">
                <div style="font-family:'Unbounded', Verdana, Arial, sans-serif; font-size:22px; font-weight:600; color:#ffffff; letter-spacing:0.5px;">
                  ${title}
                </div>
              </td>
            </tr>
            <tr>
              <td align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:24px; box-shadow:0 12px 32px rgba(0,0,0,0.18); width:100%;">
                  <tr>
                    <td align="center" style="padding: 40px 32px;">
                      <div style="font-family:'Unbounded', Verdana, Arial, sans-serif; font-size:15px; color:#3a3a3a; line-height:1.6;">
                        ${message}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top: 28px;">
                <div style="font-family:'Unbounded', Verdana, Arial, sans-serif; font-size:13px; color:#ffffffcc;">
                  If you believe this was a mistake, please contact support.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

export const sendAccountBlockedEmail = async (to: string): Promise<void> => {
  const subject = 'Your account has been blocked';
  const text =
    'Your account has been blocked by an administrator. You will not be able to sign in or use the app while this restriction is in place. If you believe this was a mistake, please contact support.';
  console.log(`\n[email] To: ${to}\n[email] Subject: ${subject}\n`);
  await send(
    to,
    subject,
    text,
    statusNoticeHtml(
      'Account blocked',
      'Your account has been blocked by an administrator.<br/>You will not be able to sign in or use the app while this restriction is in place.',
      '#E05B4F',
    ),
  );
};

export const sendAccountUnblockedEmail = async (to: string): Promise<void> => {
  const subject = 'Your account has been unblocked';
  const text =
    'Your account has been unblocked. You can now sign in and use the app as usual.';
  console.log(`\n[email] To: ${to}\n[email] Subject: ${subject}\n`);
  await send(
    to,
    subject,
    text,
    statusNoticeHtml(
      'Account unblocked',
      'Good news — your account has been unblocked.<br/>You can now sign in and use the app as usual.',
      '#4CAF7D',
    ),
  );
};

export const sendRecoveryEmail = async (to: string, token: string): Promise<void> => {
  const link = `${env.APP_BASE_URL}/api/auth/recovery/confirm?token=${token}`;
  logEmail(to, 'Account recovery request', link);
  await send(
    to,
    'Account recovery request',
    `A recovery request was made for your account. Open this link to continue:\n${link}\n\nIf you didn't request this, you can ignore this email.`,
  );
};

/**
 * The code-based counterpart to {@link sendRecoveryEmail}: delivers a short numeric
 * code the user types into the login screen to restore access by username + email.
 * Code-only email (no link), so it doesn't go through {@link logEmail}.
 */
export const sendRecoveryCodeEmail = async (to: string, code: string): Promise<void> => {
  console.log(
    `\n[email] To: ${to}\n[email] Subject: Your account login / recovery code\n[email] Code: ${code}\n`,
  );
  await send(
    to,
    'Your account login / recovery code',
    `Your login/recovery code is: ${code}\n\nIf you didn't request this, you can ignore this email.`,
  );
};
