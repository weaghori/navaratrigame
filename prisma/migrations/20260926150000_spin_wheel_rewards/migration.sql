ALTER TABLE "Reward"
  ADD COLUMN "shopifyDiscountId" TEXT,
  ADD COLUMN "prizeLabel" TEXT,
  ADD COLUMN "offerMessage" TEXT;

DROP INDEX "Reward_campaignId_customerProgressId_key";

CREATE UNIQUE INDEX "Reward_campaignId_customerProgressId_rewardType_key"
  ON "Reward"("campaignId", "customerProgressId", "rewardType");
