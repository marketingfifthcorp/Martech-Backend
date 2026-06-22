"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
dotenv.config();
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient({
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
        const res = await fetch(`${GRAPH}/${conn.accountId}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${conn.accessToken}`);
        const data = await res.json();
        console.log(`HTTP ${res.status}`);
        console.log(JSON.stringify(data, null, 2));
        if (data.data?.[0]?.values) {
            const values = data.data[0].values;
            const total = values.reduce((s, v) => s + (v.value ?? 0), 0);
            console.log(`\n--- Summary ---`);
            console.log(`Days returned : ${values.length}`);
            console.log(`Total reach   : ${total}`);
            console.log(`Non-zero days : ${values.filter((v) => v.value > 0).length}`);
        }
    }
    finally {
        await prisma.$disconnect();
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=test-ig-reach.js.map