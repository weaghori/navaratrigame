import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const source = await p.campaign.findFirst({ where: { slug: "navratri-challenge" }, include: { levels: true } });
  const target = await p.campaign.findFirst({ where: { slug: "navratri-2026" }, include: { levels: true } });
  
  if (source && target) {
    for (const sourceLevel of source.levels) {
      const targetLevel = target.levels.find(l => l.levelNumber === sourceLevel.levelNumber);
      if (targetLevel) {
        await p.level.update({
          where: { id: targetLevel.id },
          data: {
            title: sourceLevel.title,
            description: sourceLevel.description,
            activityType: sourceLevel.activityType,
            points: sourceLevel.points,
            config: sourceLevel.config,
            isActive: sourceLevel.isActive
          }
        });
        console.log(`Updated navratri-2026 level ${targetLevel.levelNumber}`);
      }
    }
    
    await p.level.deleteMany({ where: { campaignId: source.id } });
    await p.customerProgress.deleteMany({ where: { campaignId: source.id } });
    await p.campaign.delete({ where: { id: source.id } });
    console.log("Deleted navratri-challenge");
  } else {
    console.log("Campaigns not found");
  }
}

main().catch(console.error).finally(() => p.$disconnect());
