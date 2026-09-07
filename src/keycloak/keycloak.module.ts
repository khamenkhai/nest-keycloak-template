import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KeycloakService } from './keycloak.service';
import { KeycloakScopeService } from './keycloak-scope.service';
import { KeycloakResourceService } from './keycloak-resource.service';
import { KeycloakPolicyService } from './keycloak-policy.service';
import { KeycloakPermissionService } from './keycloak-premission.service';

@Module({
  imports: [ConfigModule],
  providers: [
    KeycloakService,
    KeycloakResourceService,
    KeycloakScopeService,
    KeycloakPolicyService,
    KeycloakPermissionService,
  ],
  exports: [
    KeycloakService,
    KeycloakResourceService,
    KeycloakScopeService,
    KeycloakPolicyService,
    KeycloakPermissionService,
  ],
})
export class KeycloakModule {}
