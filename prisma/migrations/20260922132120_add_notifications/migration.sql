-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_campaignId_isRead_idx" ON "Notification"("campaignId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_campaignId_createdAt_idx" ON "Notification"("campaignId", "createdAt");
