import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

export type AuditActorType = "CUSTOMER" | "ADMIN" | "SYSTEM";

export type AuditEventType =
  | "CUSTOMER_REGISTERED"
  | "LEVEL_STARTED"
  | "SUBMISSION_CREATED"
  | "SUBMISSION_APPROVED"
  | "SUBMISSION_REJECTED"
  | "POINTS_AWARDED"
  | "REFERRAL_CREATED"
  | "REFERRAL_COMPLETED"
  | "ELIGIBILITY_REACHED"
  | "WINNER_FINALIZED"
  | "REWARD_ISSUED";

export interface RecordAuditInput {
  campaignId: string;
  eventType: AuditEventType;
  actorType: AuditActorType;
  actorId: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record an immutable audit log entry
 */
export async function recordAuditEvent(input: RecordAuditInput) {
  const { campaignId, eventType, actorType, actorId, targetId, metadata } = input;

  return prisma.auditEvent.create({
    data: {
      campaignId,
      eventType,
      actorType,
      actorId,
      targetId: targetId || null,
      metadata: (metadata as Prisma.InputJsonValue) || {},
    },
  });
}

/**
 * Fetch recent audit events for admin live activity feed
 */
export async function getRecentAuditEvents({
  campaignId,
  limit = 20,
}: {
  campaignId: string;
  limit?: number;
}) {
  return prisma.auditEvent.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
