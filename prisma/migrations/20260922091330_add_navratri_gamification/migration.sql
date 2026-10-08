-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "maxPoints" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "activityType" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 100,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProgress" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "eligibleAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" TEXT NOT NULL,
    "customerProgressId" TEXT NOT NULL,
    "levelId" TEXT,
    "points" INTEGER NOT NULL,
    "transactionType" TEXT NOT NULL,
    "referenceId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "customerProgressId" TEXT NOT NULL,
    "submissionType" TEXT NOT NULL,
    "fileUrl" TEXT,
    "textResponse" TEXT,
    "quizAnswer" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "referrerCustomerId" TEXT NOT NULL,
    "referredCustomerId" TEXT,
    "referralCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerProgressId" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "rewardValue" INTEGER,
    "discountCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "issuedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Winner" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerProgressId" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "rewardAssigned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Winner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_slug_key" ON "Campaign"("slug");

-- CreateIndex
CREATE INDEX "Level_campaignId_idx" ON "Level"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Level_campaignId_levelNumber_key" ON "Level"("campaignId", "levelNumber");

-- CreateIndex
CREATE INDEX "CustomerProgress_shopifyCustomerId_idx" ON "CustomerProgress"("shopifyCustomerId");

-- CreateIndex
CREATE INDEX "CustomerProgress_campaignId_totalPoints_idx" ON "CustomerProgress"("campaignId", "totalPoints");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProgress_campaignId_shopifyCustomerId_key" ON "CustomerProgress"("campaignId", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "PointTransaction_customerProgressId_idx" ON "PointTransaction"("customerProgressId");

-- CreateIndex
CREATE INDEX "PointTransaction_levelId_idx" ON "PointTransaction"("levelId");

-- CreateIndex
CREATE INDEX "PointTransaction_createdAt_idx" ON "PointTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "Submission_campaignId_idx" ON "Submission"("campaignId");

-- CreateIndex
CREATE INDEX "Submission_customerProgressId_idx" ON "Submission"("customerProgressId");

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "Submission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_levelId_customerProgressId_key" ON "Submission"("levelId", "customerProgressId");

-- CreateIndex
CREATE INDEX "Referral_referrerCustomerId_idx" ON "Referral"("referrerCustomerId");

-- CreateIndex
CREATE INDEX "Referral_referredCustomerId_idx" ON "Referral"("referredCustomerId");

-- CreateIndex
CREATE INDEX "Referral_campaignId_idx" ON "Referral"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_campaignId_referralCode_key" ON "Referral"("campaignId", "referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Reward_discountCode_key" ON "Reward"("discountCode");

-- CreateIndex
CREATE INDEX "Reward_shopifyCustomerId_idx" ON "Reward"("shopifyCustomerId");

-- CreateIndex
CREATE INDEX "Reward_campaignId_idx" ON "Reward"("campaignId");

-- CreateIndex
CREATE INDEX "Reward_status_idx" ON "Reward"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Reward_campaignId_customerProgressId_key" ON "Reward"("campaignId", "customerProgressId");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_customerProgressId_key" ON "Winner"("customerProgressId");

-- CreateIndex
CREATE INDEX "Winner_campaignId_idx" ON "Winner"("campaignId");

-- CreateIndex
CREATE INDEX "Winner_shopifyCustomerId_idx" ON "Winner"("shopifyCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_campaignId_rank_key" ON "Winner"("campaignId", "rank");

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProgress" ADD CONSTRAINT "CustomerProgress_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_customerProgressId_fkey" FOREIGN KEY ("customerProgressId") REFERENCES "CustomerProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_customerProgressId_fkey" FOREIGN KEY ("customerProgressId") REFERENCES "CustomerProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_customerProgressId_fkey" FOREIGN KEY ("customerProgressId") REFERENCES "CustomerProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_customerProgressId_fkey" FOREIGN KEY ("customerProgressId") REFERENCES "CustomerProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
