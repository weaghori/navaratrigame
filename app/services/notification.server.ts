import prisma from "../db.server";

export type RecipientType = "ADMIN" | "CUSTOMER";

export type NotificationType =
  // Admin types
  | "NEW_SUBMISSION"
  | "SUBMISSION_APPROVED"
  | "SUBMISSION_REJECTED"
  | "NEW_ELIGIBLE_CUSTOMER"
  | "TOP_25_CHANGE"
  | "REWARD_READY"
  | "REFERRAL_COMPLETED"
  // Customer types
  | "LEVEL_UNLOCKED"
  | "SUBMISSION_RECEIVED"
  | "POINTS_EARNED"
  | "ELIGIBLE"
  | "WINNER"
  | "REWARD_ISSUED";

export interface CreateNotificationInput {
  recipientType: RecipientType;
  recipientId: string;
  campaignId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actionUrl?: string;
  idempotencyKey?: string;
}

/**
 * Creates a database-backed notification with duplicate event prevention.
 */
export async function createNotification(input: CreateNotificationInput) {
  const {
    recipientType,
    recipientId,
    campaignId,
    type,
    title,
    message,
    data,
    actionUrl,
    idempotencyKey,
  } = input;

  // Idempotency check:
  // If idempotencyKey is provided in data or as parameter, check if matching notification exists
  if (idempotencyKey) {
    const candidates = await prisma.notification.findMany({
      where: {
        campaignId,
        recipientType,
        recipientId,
        type,
      },
    });
    const existing = candidates.find((notification) =>
      notification.data && typeof notification.data === "object" && !Array.isArray(notification.data)
      && (notification.data as Record<string, unknown>).idempotencyKey === idempotencyKey,
    );

    if (existing) {
      return existing;
    }
  }

  // Also prevent duplicate milestones like ELIGIBLE or WINNER or REWARD_ISSUED for same recipient
  if (type === "ELIGIBLE" || type === "WINNER" || type === "REWARD_ISSUED") {
    const existingMilestone = await prisma.notification.findFirst({
      where: {
        campaignId,
        recipientType,
        recipientId,
        type,
      },
    });

    if (existingMilestone) {
      return existingMilestone;
    }
  }

  const notificationData = {
    ...(data || {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  return prisma.notification.create({
    data: {
      recipientType,
      recipientId,
      campaignId,
      type,
      title,
      message,
      data: notificationData,
      actionUrl: actionUrl || null,
    },
  });
}

export async function getNotifications({
  recipientType,
  recipientId,
  campaignId,
  unreadOnly = false,
  limit = 20,
}: {
  recipientType: RecipientType;
  recipientId: string;
  campaignId?: string;
  unreadOnly?: boolean;
  limit?: number;
}) {
  const where: Record<string, unknown> = {
    recipientType,
    recipientId,
  };

  if (campaignId) {
    where.campaignId = campaignId;
  }

  if (unreadOnly) {
    where.readAt = null;
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: {
        recipientType,
        recipientId,
        ...(campaignId ? { campaignId } : {}),
        readAt: null,
      },
    }),
  ]);

  return {
    notifications,
    unreadCount,
  };
}

/**
 * Get quick unread count
 */
export async function getUnreadNotificationCount({
  recipientType,
  recipientId,
  campaignId,
}: {
  recipientType: RecipientType;
  recipientId: string;
  campaignId?: string;
}) {
  return prisma.notification.count({
    where: {
      recipientType,
      recipientId,
      ...(campaignId ? { campaignId } : {}),
      readAt: null,
    },
  });
}

/**
 * Mark a single notification as read
 */
export async function markNotificationRead(notificationId: string, recipientId?: string) {
  const where: Record<string, unknown> = { id: notificationId };
  if (recipientId) {
    where.recipientId = recipientId;
  }

  return prisma.notification.updateMany({
    where,
    data: {
      readAt: new Date(),
    },
  });
}

/**
 * Mark all notifications as read for a recipient
 */
export async function markAllNotificationsRead({
  recipientType,
  recipientId,
  campaignId,
}: {
  recipientType: RecipientType;
  recipientId: string;
  campaignId?: string;
}) {
  return prisma.notification.updateMany({
    where: {
      recipientType,
      recipientId,
      ...(campaignId ? { campaignId } : {}),
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });
}
