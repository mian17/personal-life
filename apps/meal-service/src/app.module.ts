import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { Food } from './foods/food.entity';
import { FoodsModule } from './foods/foods.module';
import { Serving } from './foods/serving.entity';
import { HealthModule } from './health/health.module';
import { KeysModule } from './keys/keys.module';
import { UserKeys } from './keys/user-keys.entity';
import { Target } from './targets/target.entity';
import { TargetModule } from './targets/target.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db'),
      entities: [UserKeys, Target, Food, Serving],
      synchronize: true,
    }),
    KeysModule,
    HealthModule,
    TargetModule,
    FoodsModule,
  ],
})
export class AppModule {}