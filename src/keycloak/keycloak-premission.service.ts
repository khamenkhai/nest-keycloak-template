import { Injectable } from '@nestjs/common';
import { KeycloakService } from './keycloak.service';
import PolicyRepresentation from '@keycloak/keycloak-admin-client/lib/defs/policyRepresentation';

@Injectable()
export class KeycloakPermissionService {
  private readonly keycloakClientId: string = process.env.KEYCLOAK_CLIENT_ID!;

  constructor(private readonly keycloakService: KeycloakService) {}

  async createPermission(payload: PolicyRepresentation) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      return await keycloakClient.clients.createPermission(
        {
          id: this.keycloakClientId,
          type: 'scope',
        },
        payload,
      );
    }
  }

  async updatePermission(
    resourceName: string,
    policyName: string,
    scopes: string[],
  ) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      const permission = await keycloakClient.clients.findPermissions({
        id: this.keycloakClientId,
        resource: resourceName,
      });

      for (const element of permission) {
        const associatedPolicies =
          await keycloakClient.clients.getAssociatedPolicies({
            id: this.keycloakClientId,
            permissionId: element.id!,
          });

        const associatedScopes =
          await keycloakClient.clients.getAssociatedScopes({
            id: this.keycloakClientId,
            permissionId: element.id!,
          });

        const isScopeIncluded = associatedScopes.some((scope) =>
          scopes.includes(scope.name),
        );

        const isPolicyIncluded = associatedPolicies.some(
          (policy) => policy.name === policyName,
        );

        if (!isScopeIncluded && isPolicyIncluded) {
          const updatedPolicy = associatedPolicies
            .filter((policy) => policy.name !== policyName)
            .map((policy) => policy.name)
            .filter((name): name is string => name !== undefined);

          await keycloakClient.clients.updatePermission(
            {
              id: this.keycloakClientId,
              type: 'scope',
              permissionId: element.id!,
            },
            {
              ...element,
              policies: updatedPolicy,
            },
          );
        } else if (isScopeIncluded) {
          await keycloakClient.clients.updatePermission(
            {
              id: this.keycloakClientId,
              type: 'scope',
              permissionId: element.id!,
            },
            {
              ...element,
              policies: [
                ...associatedPolicies
                  .map((policy) => policy.name)
                  .filter((name): name is string => name !== undefined),
                policyName,
              ],
            },
          );
        }
      }

      console.log('Finished Update Permission');
    }
  }
}
