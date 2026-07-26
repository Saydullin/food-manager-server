import type { ComplaintStatus, ComplaintTargetType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { toPagedResult, type PagedResult } from '../utils/pagination';
import { DEFAULT_LANGUAGE } from './foodService';

const complaintInclude = {
  reporter: { select: { id: true, username: true } },
  targetUser: { select: { id: true, username: true } },
  targetFood: { select: { id: true, translations: { select: { language: true, name: true } } } },
  resolvedByAdmin: { select: { id: true, name: true } },
} as const;

// The target dish's name in its default language (falling back to whichever
// translation exists), since Food itself no longer carries a bare `name`.
const targetFoodName = (translations: { language: string; name: string }[]): string =>
  translations.find((t) => t.language === DEFAULT_LANGUAGE)?.name ?? translations[0]?.name ?? '';

export interface ComplaintView {
  id: string;
  targetType: ComplaintTargetType;
  reason: string;
  status: ComplaintStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  reporter: { id: string; username: string };
  targetUser: { id: string; username: string } | null;
  targetFood: { id: string; name: string } | null;
  resolvedByAdmin: { id: string; name: string } | null;
}

const shapeComplaint = (row: {
  id: string;
  targetType: ComplaintTargetType;
  reason: string;
  status: ComplaintStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  reporter: { id: string; username: string };
  targetUser: { id: string; username: string } | null;
  targetFood: { id: string; translations: { language: string; name: string }[] } | null;
  resolvedByAdmin: { id: string; name: string } | null;
}): ComplaintView => ({
  ...row,
  targetFood: row.targetFood
    ? { id: row.targetFood.id, name: targetFoodName(row.targetFood.translations) }
    : null,
});

export interface FileComplaintInput {
  targetType: ComplaintTargetType;
  targetUserId?: string;
  targetFoodId?: string;
  reason: string;
}

/** Files a complaint (report) against a user or a dish, from the reporting user. */
export const fileComplaint = async (reporterId: string, input: FileComplaintInput): Promise<ComplaintView> => {
  if (input.targetType === 'USER' && input.targetUserId === reporterId) {
    throw AppError.badRequest('You cannot report yourself', 'CANNOT_REPORT_SELF');
  }

  if (input.targetType === 'USER') {
    const target = await prisma.user.findUnique({ where: { id: input.targetUserId! }, select: { id: true } });
    if (!target) throw AppError.notFound('Target user not found', 'USER_NOT_FOUND');
  } else {
    const target = await prisma.food.findUnique({ where: { id: input.targetFoodId! }, select: { id: true } });
    if (!target) throw AppError.notFound('Target dish not found', 'FOOD_NOT_FOUND');
  }

  const row = await prisma.complaint.create({
    data: {
      reporterId,
      targetType: input.targetType,
      targetUserId: input.targetType === 'USER' ? input.targetUserId : null,
      targetFoodId: input.targetType === 'FOOD' ? input.targetFoodId : null,
      reason: input.reason,
    },
    include: complaintInclude,
  });
  return shapeComplaint(row);
};

export interface ListComplaintsParams {
  status?: ComplaintStatus;
  page: number;
  pageSize: number;
}

export const listComplaints = async ({
  status,
  page,
  pageSize,
}: ListComplaintsParams): Promise<PagedResult<ComplaintView>> => {
  const where: Prisma.ComplaintWhereInput = status ? { status } : {};

  const [rows, total] = await Promise.all([
    prisma.complaint.findMany({
      where,
      include: complaintInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.complaint.count({ where }),
  ]);

  return toPagedResult(rows.map(shapeComplaint), page, pageSize, total);
};

/** Marks a complaint resolved or dismissed by the acting admin. */
export const resolveComplaint = async (
  adminId: string,
  complaintId: string,
  status: 'RESOLVED' | 'DISMISSED',
): Promise<ComplaintView> => {
  const existing = await prisma.complaint.findUnique({ where: { id: complaintId } });
  if (!existing) throw AppError.notFound('Complaint not found', 'COMPLAINT_NOT_FOUND');

  const row = await prisma.complaint.update({
    where: { id: complaintId },
    data: { status, resolvedByAdminId: adminId, resolvedAt: new Date() },
    include: complaintInclude,
  });
  return shapeComplaint(row);
};
