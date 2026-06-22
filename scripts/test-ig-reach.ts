/**
 * One-off diagnostic: verify /{ig-user-id}/insights?metric=reach returns live data
 * on Graph API v23.0 using the stored page token.
 *
 * Run from backend/: npx ts-node scripts/test-ig-reach.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

// Use direct connection for this standalone script — pgBouncer (port 6543) is
// saturated by the running backend, so we target the direct Postgres URL (port 5432).
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

const GRAPH = 'https://graph.facebook.com/v23.0';

async function main() {
  try {
    const conn = await prisma.platformConnection.findFirst({
      where: { platform: 'instagram', isActive: true },
    });

    if (!conn) {
      console.log('No active Instagram connection found in DB.');
      return;
    }

    console.log(`Connection : ${conn.accountName}  |  IG user ID: ${conn.accountId}`);

    const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const until = Math.floor(Date.now() / 1000);

    console.log(`\nGET ${GRAPH}/${conn.accountId}/insights?metric=reach&period=day&since=<ts>&until=<ts>\n`);

    const res = await fetch(
      `${GRAPH}/${conn.accountId}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${conn.accessToken}`,
    );
    const data = await res.json() as any;

    console.log(`HTTP ${res.status}`);
    console.log(JSON.stringify(data, null, 2));

    if (data.data?.[0]?.values) {
      const values: { value: number; end_time: string }[] = data.data[0].values;
      const total = values.reduce((s, v) => s + (v.value ?? 0), 0);
      console.log(`\n--- Summary ---`);
      console.log(`Days returned : ${values.length}`);
      console.log(`Total reach   : ${total}`);
      console.log(`Non-zero days : ${values.filter((v) => v.value > 0).length}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
