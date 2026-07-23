import { env } from '../config/env';

/**
 * SMTP is not wired up yet — every "sent" email is logged to the console
 * instead, with the link the real email would contain.
 */
const logEmail = (to: string, subject: string, link: string): void => {
  console.log(
    `\n[email] To: ${to}\n[email] Subject: ${subject}\n[email] Link: ${link}\n`,
  );
};

export const sendVerificationEmail = (to: string, token: string, code: string): void => {
  const link = `${env.APP_BASE_URL}/api/auth/email/verify?token=${token}`;
  logEmail(to, 'Verify your email', link);
  console.log(`[email] Code: ${code}\n`);
};

export const sendRecoveryEmail = (to: string, token: string): void => {
  const link = `${env.APP_BASE_URL}/api/auth/recovery/confirm?token=${token}`;
  logEmail(to, 'Account recovery request', link);
};

/**
 * The code-based counterpart to {@link sendRecoveryEmail}: delivers a short numeric
 * code the user types into the login screen to restore access by username + email.
 * Code-only email (no link), so it doesn't go through {@link logEmail}.
 */
export const sendRecoveryCodeEmail = (to: string, code: string): void => {
  console.log(
    `\n[email] To: ${to}\n[email] Subject: Your account login / recovery code\n[email] Code: ${code}\n`,
  );
};
