import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KeycloakService } from './keycloak.service';
import { KeycloakScopeService } from './keycloak-scope.service';
import { KeycloakResourceService } from './keycloak-resource.service';
import { KeycloakPolicyService } from './keycloak-policy.service';
import { KeycloakPermissionService } from './keycloak-premission.service';
import { KeycloakSetupService } from './keycloak-setup.service';
import { KeycloakSetupController } from './keycloak-setup.controller';

@Module({
  imports: [ConfigModule],
  controllers: [KeycloakSetupController],
  providers: [
    KeycloakService,
    KeycloakResourceService,
    KeycloakScopeService,
    KeycloakPolicyService,
    KeycloakPermissionService,
    KeycloakSetupService,
  ],
  exports: [
    KeycloakService,
    KeycloakResourceService,
    KeycloakScopeService,
    KeycloakPolicyService,
    KeycloakPermissionService,
    KeycloakSetupService,
  ],
})
export class KeycloakModule {}
