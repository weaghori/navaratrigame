import { PrismaClient } from "../generated/mongodb-runtime-client/index.js";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function getPrismaClient(): PrismaClient {
  // Reuse one Prisma client (and therefore one bounded connection pool) for
  // this server process in both development and production. This also avoids
  // creating extra pools when the server module is loaded more than once.
  global.prismaGlobal ??= new PrismaClient();
  return global.prismaGlobal;
}

const prisma = getPrismaClient();

export default prisma;

