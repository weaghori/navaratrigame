import { PrismaClient } from "@prisma/client";
import { campaignLevelTemplate } from "../app/services/campaign-level-template";

const prisma = new PrismaClient();

async function main() {
  const campaign = await prisma.campaign.upsert({
    where: { shop_slug: { shop: "demo-store.myshopify.com", slug: "navratri-2026" } },
    update: {
      name: "Navratri 2026",
      description: "Complete 10 festive challenges, collect 1,000 points, and unlock exclusive rewards.",
      startDate: new Date("2026-09-22T00:00:00.000Z"),
      endDate: new Date("2026-10-05T23:59:59.000Z"),
      status: "active",
      maxPoints: 1000,
    },
    create: {
      shop: "demo-store.myshopify.com",
      name: "Navratri 2026",
      slug: "navratri-2026",
      description: "Complete 10 festive challenges, collect 1,000 points, and unlock exclusive rewards.",
      startDate: new Date("2026-09-22T00:00:00.000Z"),
      endDate: new Date("2026-10-05T23:59:59.000Z"),
      status: "active",
      maxPoints: 1000,
    },
  });

  // Keep uploaded tune data when re-seeding the existing demo campaign.
  const existingAudio = await prisma.level.findFirst({ where: { campaignId: campaign.id, activityType: "audio_guess" }, select: { config: true } });
  const audioConfig = existingAudio?.config && typeof existingAudio.config === "object" && !Array.isArray(existingAudio.config)
    ? existingAudio.config as Record<string, unknown>
    : {};

  for (const level of campaignLevelTemplate) {
    const config = level.levelNumber === 6
      ? {
          ...level.config,
          ...(typeof audioConfig.audioUrl === "string" && audioConfig.audioUrl ? { audioUrl: audioConfig.audioUrl } : {}),
          ...(typeof audioConfig.answer === "string" && audioConfig.answer ? { answer: audioConfig.answer } : {}),
          ...(Array.isArray(audioConfig.acceptedAnswers) ? { acceptedAnswers: audioConfig.acceptedAnswers } : {}),
        }
      : level.config;
    await prisma.level.upsert({
      where: { campaignId_levelNumber: { campaignId: campaign.id, levelNumber: level.levelNumber } },
      update: { title: level.title, description: level.description, activityType: level.activityType, points: level.points, config, isActive: true },
      create: { campaignId: campaign.id, ...level, config, isActive: true },
    });
  }

  // Retire old levels after Level 10 without deleting their historical relations.
  await prisma.level.updateMany({ where: { campaignId: campaign.id, levelNumber: { gt: 10 }, isActive: true }, data: { isActive: false } });
  console.log(`Seeded ${campaignLevelTemplate.length} levels for ${campaign.name}; total points: ${campaignLevelTemplate.reduce((sum, level) => sum + level.points, 0)}.`);
}

main()
  .catch((error) => {
    console.error("Seed error:", error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
