import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const candidates = await prisma.level.findMany({
    where: {
      activityType: "movie_guess",
      isActive: true,
      campaign: {
        status: "active",
        startDate: { lte: now },
        endDate: { gte: now },
      },
    },
    select: {
      id: true,
      levelNumber: true,
      title: true,
      campaign: { select: { id: true, name: true, shop: true, slug: true } },
    },
  });

  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? "No active campaign has an enabled movie-guess level to update."
        : `Found ${candidates.length} active movie-guess levels; refusing to guess which campaign should be changed.`,
    );
  }

  const level = candidates[0];
  await prisma.level.update({
    where: { id: level.id },
    data: {
      config: {
        clue: "👨‍👨‍👦👶🏠😂",
        answer: "Golmaal 3",
        acceptedAnswers: ["Golmaal Three", "Golmaal III"],
        options: [],
      },
    },
  });
  console.log(`Updated Day ${level.levelNumber} (${level.title}) in ${level.campaign.name} / ${level.campaign.shop} with the Golmaal 3 emoji clue.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Could not update the movie-guess sample.");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
