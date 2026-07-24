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

const send = async (to: string, subject: string, text: string): Promise<void> => {
  if (!transporter) return;
  try {
    await transporter.sendMail({ from: env.SMTP_FROM, to, subject, text });
  } catch (err) {
    // Sending is fire-and-forget from callers' perspective (token/code is already
    // persisted), so a delivery failure must not crash the request — just surface it.
    console.error(`[email] Failed to send "${subject}" to ${to}:`, err);
  }
};

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
