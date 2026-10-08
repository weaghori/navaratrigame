import prisma from "../db.server";
import { createNotification } from "./notification.server";
import { recordAuditEvent } from "./audit.server";

export interface IssueRewardOptions {
  campaignId: string;
  customerProgressId: string;
  rewardType?: "discount" | "hamper" | "gift" | "custom";
  percentage?: number;
  adminUser?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminGraphqlClient?: any;
  isTestRunner?: boolean;
}

/**
 * Generate a unique coupon code for Shopify Discount
 */
function generateDiscountCode(campaignSlug: string, customerId: string, percentage: number): string {
  const cleanId = customerId.replace(/\D/g, "").slice(-4) || Math.random().toString(36).substring(2, 6).toUpperCase();
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const prefix = campaignSlug.split("-")[0]?.toUpperCase() || "NAV";
  return `${prefix}${percentage}-${cleanId}-${randomSuffix}`;
}

export type WheelDiscountAdminClient = {
  graphql: (query: string, options: { variables: Record<string, unknown> }) => Promise<Response>;
};

export async function createWheelDiscountCode({
  adminGraphqlClient,
  campaignSlug,
  customerId,
  percentage,
}: {
  adminGraphqlClient: WheelDiscountAdminClient;
  campaignSlug: string;
  customerId: string;
  percentage: number;
}) {
  const code = generateDiscountCode(campaignSlug, customerId, percentage);
  const customerGid = customerId.startsWith("gid://shopify/Customer/")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const response = await adminGraphqlClient.graphql(`#graphql
    mutation CreateCustomerWheelOffer($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      input: {
        title: `Navratri Wheel Offer ${percentage}% - ${customerId.slice(-6)}`,
        code,
        startsAt: new Date().toISOString(),
        endsAt: expiresAt.toISOString(),
        context: { customers: { add: [customerGid] } },
        customerGets: { value: { percentage: percentage / 100 }, items: { all: true } },
        usageLimit: 1,
        appliesOncePerCustomer: true,
      },
    },
  });
  const payload = await response.json() as {
    data?: { discountCodeBasicCreate?: { codeDiscountNode?: { id?: string }; userErrors?: Array<{ field?: string[]; message: string }> } };
    errors?: Array<{ message: string }>;
  };
  const failure = payload.errors?.[0]?.message || payload.data?.discountCodeBasicCreate?.userErrors?.[0]?.message;
  const discountId = payload.data?.discountCodeBasicCreate?.codeDiscountNode?.id;
  if (failure || !discountId) throw new Error(failure || "Shopify did not return the wheel discount.");
  return { code, discountId, expiresAt };
}

export async function deactivateWheelDiscountCode({
  adminGraphqlClient,
  discountId,
}: {
  adminGraphqlClient: WheelDiscountAdminClient;
  discountId: string;
}) {
  const response = await adminGraphqlClient.graphql(`#graphql
    mutation DeactivateWheelOffer($id: ID!) {
      discountCodeDeactivate(id: $id) {
        userErrors { message }
      }
    }
  `, { variables: { id: discountId } });
  const payload = await response.json() as {
    data?: { discountCodeDeactivate?: { userErrors?: Array<{ message: string }> } };
    errors?: Array<{ message: string }>;
  };
  const failure = payload.errors?.[0]?.message || payload.data?.discountCodeDeactivate?.userErrors?.[0]?.message;
  if (failure) throw new Error(failure);
}

/**
 * Creates a real Shopify Basic Percentage Discount Code via Shopify Admin GraphQL API
 */
async function createShopifyDiscountCode({
  adminGraphqlClient,
  title,
  code,
  percentage,
  isTestRunner,
}: {
  adminGraphqlClient?: IssueRewardOptions["adminGraphqlClient"];
  title: string;
  code: string;
  percentage: number;
  isTestRunner?: boolean;
}): Promise<{ success: boolean; discountId?: string; error?: string }> {
  if (!adminGraphqlClient) {
    if (isTestRunner === true) {
      // Allowed strictly during automated CLI test runner verification
      return {
        success: true,
        discountId: `gid://shopify/DiscountCodeNode/test_${Date.now()}`,
      };
    }
    return {
      success: false,
      error: "Unable to create Shopify discount: Authenticated Shopify Admin API client is required.",
    };
  }

  try {
    const startsAt = new Date().toISOString();
    const decimalPercentage = percentage / 100;

    const mutation = `#graphql
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                status
              }
            }
          }
          userErrors {
            field
            code
            message
          }
        }
      }
    `;

    const variables = {
      basicCodeDiscount: {
        title,
        code,
        startsAt,
        usageLimit: 1,
        appliesOncePerCustomer: true,
        customerGets: {
          value: {
            percentage: decimalPercentage,
          },
          items: {
            all: true,
          },
        },
        customerSelection: {
          all: true,
        },
      },
    };

    const response = await adminGraphqlClient.query(mutation, { variables });
    const result = (await response.json()) as {
      data?: {
        discountCodeBasicCreate?: {
          codeDiscountNode?: { id: string };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (result.errors && result.errors.length > 0) {
      return { success: false, error: `Unable to create Shopify discount: ${result.errors[0].message}` };
    }

    const userErrors = result.data?.discountCodeBasicCreate?.userErrors;
    if (userErrors && userErrors.length > 0) {
      return { success: false, error: `Unable to create Shopify discount: ${userErrors[0].message}` };
    }

    const nodeId = result.data?.discountCodeBasicCreate?.codeDiscountNode?.id;
    if (!nodeId) {
      return { success: false, error: "Unable to create Shopify discount: No discount ID returned." };
    }

    return {
      success: true,
      discountId: nodeId,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Shopify Admin GraphQL request failed";
    return { success: false, error: `Unable to create Shopify discount: ${msg}` };
  }
}

/**
 * Issue a reward to an eligible customer:
 * - Checks eligibility (1000 points / status)
 * - Generates real Shopify Discount code
 * - Stores Reward record atomically
 * - Emits customer and admin notifications
 */
export async function issueCustomerReward(options: IssueRewardOptions) {
  const {
    campaignId,
    customerProgressId,
    rewardType = "discount",
    percentage = 10,
    adminUser,
    adminGraphqlClient,
    isTestRunner,
  } = options;

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Fetch customer progress with campaign
      const progress = await tx.customerProgress.findUnique({
        where: { id: customerProgressId },
        include: {
          campaign: true,
          winner: true,
          rewards: true,
        },
      });

      if (!progress) {
        throw new Error("Customer progress not found.");
      }

      if (progress.campaignId !== campaignId) {
        throw new Error("Customer progress does not belong to the selected campaign.");
      }

      // 2. Eligibility verification
      const maxPoints = progress.campaign.maxPoints || 1000;
      const isEligible =
        progress.totalPoints >= maxPoints ||
        progress.status === "eligible" ||
        progress.status === "completed" ||
        progress.status === "winner";

      if (!isEligible) {
        throw new Error(
          `Customer is not yet eligible for rewards. Required: ${maxPoints} pts, Current: ${progress.totalPoints} pts.`,
        );
      }

      // 3. Duplicate check
      const existingIssued = progress.rewards.find(
        (r) => !r.rewardType.startsWith("spin_discount") && (r.status === "issued" || r.status === "pending"),
      );

      if (existingIssued) {
        throw new Error(
          `A reward (${existingIssued.discountCode || existingIssued.rewardType}) has already been issued for this customer.`,
        );
      }

      // 4. Generate Code and create discount on Shopify
      const discountCode = generateDiscountCode(
        progress.campaign.slug,
        progress.shopifyCustomerId,
        percentage,
      );

      const title = `Navratri Reward: ${percentage}% OFF - ${progress.shopifyCustomerId}`;
      const shopifyResult = await createShopifyDiscountCode({
        adminGraphqlClient,
        title,
        code: discountCode,
        percentage,
        isTestRunner,
      });

      if (!shopifyResult.success) {
        throw new Error(shopifyResult.error || "Unable to create Shopify discount.");
      }

      // 5. Expiration: 30 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // 6. Persist Reward record
      const reward = await tx.reward.create({
        data: {
          campaignId,
          customerProgressId: progress.id,
          shopifyCustomerId: progress.shopifyCustomerId,
          rewardType,
          rewardValue: percentage,
          discountCode,
          shopifyDiscountId: shopifyResult.discountId,
          status: "issued",
          issuedAt: new Date(),
          expiresAt,
        },
      });

      // 7. If customer is a finalized winner, mark rewardAssigned = true
      if (progress.winner) {
        await tx.winner.update({
          where: { id: progress.winner.id },
          data: { rewardAssigned: true },
        });
      }

      return {
        success: true,
        reward,
        discountCode,
        issuedBy: adminUser || "Shopify Admin",
        progress,
        campaign: progress.campaign,
      };
    },
    { maxWait: 15000, timeout: 30000 },
  );

  // Trigger Notifications & Audit Log outside transaction
  try {
    const customerId = result.progress.shopifyCustomerId;

    // Customer Notification
    await createNotification({
      recipientType: "CUSTOMER",
      recipientId: customerId,
      campaignId,
      type: "REWARD_ISSUED",
      title: "🎁 Your Navratri Reward is Ready!",
      message: `Congratulations! Here is your ${percentage}% OFF discount code: ${result.discountCode}. Use it at checkout!`,
      actionUrl: `/campaigns/${result.campaign.slug}`,
      data: {
        discountCode: result.discountCode,
        percentage,
        expiresAt: result.reward.expiresAt?.toISOString(),
      },
      idempotencyKey: `reward_${result.reward.id}`,
    });

    // Admin Notification
    await createNotification({
      recipientType: "ADMIN",
      recipientId: "admin",
      campaignId,
      type: "REWARD_READY",
      title: "Shopify Discount Code Created 🎁",
      message: `Created ${percentage}% OFF code (${result.discountCode}) for ${customerId}.`,
      actionUrl: "/app/rewards",
      idempotencyKey: `admin_reward_${result.reward.id}`,
    });

    // Audit Event
    await recordAuditEvent({
      campaignId,
      eventType: "REWARD_ISSUED",
      actorType: "ADMIN",
      actorId: adminUser || "Admin",
      targetId: result.reward.id,
      metadata: {
        customerId,
        discountCode: result.discountCode,
        percentage,
      },
    });
  } catch (err) {
    console.error("Non-blocking notification error in issueCustomerReward:", err);
  }

  return {
    success: true,
    reward: result.reward,
    discountCode: result.discountCode,
    issuedBy: result.issuedBy,
  };
}

/**
 * Fetch customer's reward information for the storefront
 */
export async function getCustomerReward(campaignId: string, shopifyCustomerId: string) {
  const cleanCustomerId = String(shopifyCustomerId).trim();

  return prisma.reward.findFirst({
    where: {
      campaignId,
      shopifyCustomerId: cleanCustomerId,
      status: { not: "cancelled" },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * List all rewards with filtering and pagination for Admin Dashboard
 */
export async function getRewardsList({
  campaignId,
  status,
  page = 1,
  limit = 50,
}: {
  campaignId?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const where: Record<string, unknown> = {};
  if (campaignId) where.campaignId = campaignId;
  if (status && status !== "all") where.status = status;

  const [rewards, totalCount] = await Promise.all([
    prisma.reward.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        customerProgress: {
          include: {
            winner: true,
          },
        },
      },
    }),
    prisma.reward.count({ where }),
  ]);

  return {
    rewards,
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit),
  };
}

/**
 * Cancel an issued reward by admin
 */
export async function cancelRewardAdmin({
  rewardId,
  adminUser,
}: {
  rewardId: string;
  adminUser?: string;
}) {
  const reward = await prisma.reward.findUnique({
    where: { id: rewardId },
  });

  if (!reward) {
    throw new Error("Reward record not found.");
  }

  return prisma.reward.update({
    where: { id: rewardId },
    data: {
      status: "cancelled",
    },
  });
}
