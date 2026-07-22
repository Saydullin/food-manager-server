import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as authService from '../services/authService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerUser(req.body);
  res.status(201).json(result);
});

export const checkUsernameAvailability = asyncHandler(async (req: Request, res: Response) => {
  const available = await authService.isUsernameAvailable(req.query.username as string);
  res.status(200).json({ available });
});

export const challenge = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.createLoginChallenge(req.body.username);
  res.status(200).json(result);
});

export const verify = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyLogin(req.body);
  res.status(200).json(result);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.refreshSession(req.body.refreshToken);
  res.status(200).json(result);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.body.refreshToken);
  res.status(200).json({ message: 'Logged out' });
});

export const addEmail = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  await authService.addEmail(req.auth!.userId, req.body.email);
  res.status(200).json({ message: 'Verification email sent' });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  await authService.verifyEmailToken(req.query.token as string);
  res.status(200).json({ message: 'Email verified' });
});

export const verifyEmailCode = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  await authService.verifyEmailCode(req.auth!.userId, req.body.code);
  res.status(200).json({ message: 'Email verified' });
});

export const requestRecovery = asyncHandler(async (req: Request, res: Response) => {
  await authService.requestRecovery(req.body);
  res.status(200).json({
    message: 'If an account matching that information exists, a recovery email has been sent.',
  });
});

export const confirmRecovery = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.confirmRecovery(req.body);
  res.status(200).json(result);
});
