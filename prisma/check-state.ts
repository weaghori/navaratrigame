import prisma from '../app/db.server.js';

async function check() {
  const campaign = await prisma.campaign.findFirst({ where: { status: 'active' } });
  if (!campaign) { console.log('No active campaign'); return; }
  console.log('Campaign:', campaign.name, campaign.slug, campaign.status);
  
  const notifCount = await prisma.notification.count();
  const auditCount = await prisma.auditEvent.count();
  const levelCount = await prisma.level.count({ where: { campaignId: campaign.id } });
  const participantCount = await prisma.customerProgress.count({ where: { campaignId: campaign.id } });
  
  const stats = await prisma.customerProgress.findMany({
    where: { campaignId: campaign.id },
    select: { shopifyCustomerId: true, totalPoints: true, status: true }
  });
  
  console.log('Levels:', levelCount);
  console.log('Participants:', participantCount);
  console.log('Notifications:', notifCount);
  console.log('Audit Events:', auditCount);
  
  // Check schema for availableFrom column
  const firstLevel = await prisma.level.findFirst({ where: { campaignId: campaign.id } });
  console.log('Level has availableFrom:', 'availableFrom' in (firstLevel || {}));
  
  console.log('\nParticipant Summary:');
  for (const p of stats) {
    console.log(`  ${p.shopifyCustomerId}: ${p.totalPoints} pts [${p.status}]`);
  }
}

check()
  .catch(console.error)
  .finally(() => process.exit(0));
