import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { KeycloakModule } from 'src/keycloak';

@Module({
  imports: [KeycloakModule, ConfigModule],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
