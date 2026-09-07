import { Module } from '@nestjs/common';
import { KeycloakConfig } from './keyclock';

@Module({
  providers: [KeycloakConfig],
  exports: [KeycloakConfig],
})
export class KeycloakConfigModule {}
