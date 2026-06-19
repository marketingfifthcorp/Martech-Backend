// Test: does followers_count work with current token (instagram_basic scope)?
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();
const { PrismaClient } = require('@prisma/client');
const GRAPH = 'https://graph.facebook.com/v23.0';

async function main() {
  const prisma = new PrismaClient();
  try {
    const conn = await prisma.platformConnection.findFirst({ where: { platform: 'instagram', isActive: true } });
    if (!conn) { console.log('No connection'); return; }

    // Test 1: followers_count from profile field (instagram_basic)
    const profileRes = await fetch(`${GRAPH}/${conn.accountId}?fields=followers_count,username&access_token=${conn.accessToken}`);
    const profileData = await profileRes.json();
    console.log('Profile field (followers_count):');
    console.log(JSON.stringify(profileData, null, 2));

    // Test 2: media list to check if we can see post-level data
    const mediaRes = await fetch(`${GRAPH}/${conn.accountId}/media?fields=id,like_count,comments_count,timestamp&limit=3&access_token=${conn.accessToken}`);
    const mediaData = await mediaRes.json();
    console.log('\nMedia list (like_count, comments_count):');
    console.log(JSON.stringify(mediaData, null, 2));

  } finally { await prisma.$disconnect(); }
}
main().catch(console.error);
