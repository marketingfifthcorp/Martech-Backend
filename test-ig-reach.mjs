// One-off script: verify Instagram Insights reach metric still returns live data on v23.0
// Run from backend dir: node test-ig-reach.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const dotenv = require('dotenv');
dotenv.config();

const { PrismaClient } = require('@prisma/client');

const GRAPH = 'https://graph.facebook.com/v23.0';

async function main() {
  const prisma = new PrismaClient();

  try {
    const conn = await prisma.platformConnection.findFirst({
      where: { platform: 'instagram', isActive: true },
    });

    if (!conn) {
      console.log('No active Instagram connection found in DB. Connect one first.');
      return;
    }

    console.log(`Using connection: ${conn.accountName} | IG user ID: ${conn.accountId}`);

    const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const until = Math.floor(Date.now() / 1000);

    const url = `${GRAPH}/${conn.accountId}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${conn.accessToken}`;
    console.log(`\nGET ${GRAPH}/${conn.accountId}/insights?metric=reach&period=day&since=<since>&until=<until>`);

    const res = await fetch(url);
    const data = await res.json();

    console.log(`\nHTTP status: ${res.status}`);
    console.log('\nRaw response:');
    console.log(JSON.stringify(data, null, 2));

    if (data.data?.[0]?.values) {
      const values = data.data[0].values;
      const total = values.reduce((s, v) => s + (v.value ?? 0), 0);
      console.log(`\n--- Summary ---`);
      console.log(`Days returned: ${values.length}`);
      console.log(`Total reach over period: ${total}`);
      console.log(`Non-zero days: ${values.filter(v => v.value > 0).length}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
