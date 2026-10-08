CREATE TABLE "PurchaseVerification" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerProgressId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseVerification_shop_shopifyOrderId_key"
    ON "PurchaseVerification"("shop", "shopifyOrderId");
CREATE INDEX "PurchaseVerification_campaignId_customerProgressId_completedAt_idx"
    ON "PurchaseVerification"("campaignId", "customerProgressId", "completedAt");
ALTER TABLE "PurchaseVerification"
    ADD CONSTRAINT "PurchaseVerification_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseVerification"
    ADD CONSTRAINT "PurchaseVerification_customerProgressId_fkey"
    FOREIGN KEY ("customerProgressId") REFERENCES "CustomerProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
