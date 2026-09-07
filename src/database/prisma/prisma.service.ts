import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from 'src/database/generated/client/client';
import { hasSoftDeleteCondition } from './soft-delete.util';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    const adapter = new PrismaPg(pool);

    super({ adapter });
    this.pool = pool;

    const softDeleteModels = new Set([
      'Organization',
      'ContactPerson',
      'Category',
      'Brand',
      'SubBrand',
      'DistributionCompany',
      'SkuMaster',
      'Product',
      'Uom',
      'WeightUom',
      'Province',
      'City',
      'Township',
      'SubscriptionPlan',
      'Module',
      'Resource',
      'Scope',
      'HelpCenterCategory',
      'HelpCenterArticle',
      'HelpCenterArticleMedia',
    ]);
    const readOperations = new Set([
      'findUnique',
      'findUniqueOrThrow',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
    ]);

    // Application reads hide soft-deleted rows by default. Internal restore
    // paths opt out by supplying an explicit `isDeleted` condition.
    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const queryArgs = args as Record<string, any>;
            if (
              !softDeleteModels.has(model) ||
              !readOperations.has(operation) ||
              hasSoftDeleteCondition(queryArgs.where)
            ) {
              return query(args);
            }

            if (
              operation === 'findUnique' ||
              operation === 'findUniqueOrThrow'
            ) {
              queryArgs.where = {
                ...(queryArgs.where ?? {}),
                isDeleted: false,
              };
            } else {
              queryArgs.where = {
                AND: [{ isDeleted: false }, queryArgs.where ?? {}],
              };
            }
            return query(args);
          },
        },
      },
    }) as this;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
