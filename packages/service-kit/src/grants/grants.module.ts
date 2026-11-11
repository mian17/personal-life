import { Module, type DynamicModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrantsService } from './grants.service.js';
import { OriginGrant } from './origin-grant.entity.js';

/**
 * The origin-grant lookup layer, wired from one implementation, mirroring
 * `KeysModule.forRoot`.
 *
 * A hub imports `GrantsModule.forRoot()` and injects `GrantsService`. The module
 * opens no connection of its own: `TypeOrmModule.forFeature` registers the entity
 * against the DataSource the importing hub already established, so the
 * `origin_grant` table lands in that hub's database.
 */
@Module({})
export class GrantsModule {
  static forRoot(): DynamicModule {
    return {
      module: GrantsModule,
      imports: [TypeOrmModule.forFeature([OriginGrant])],
      providers: [GrantsService],
      exports: [GrantsService],
    };
  }
}
