import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const rows = await prisma.platformConnection.findMany({
  select: { id: true, platform: true, accountName: true, isActive: true, clientId: true },
});
console.log(JSON.stringify(rows, null, 2));
await prisma.$disconnect();
