import { Injectable } from '@nestjs/common';
import { KeycloakService } from './keycloak.service';
import ResourceRepresentation from '@keycloak/keycloak-admin-client/lib/defs/resourceRepresentation';

@Injectable()
export class KeycloakResourceService {
  private readonly keycloakClientId: string = process.env.CLIENT_KEYCLOAK_ID!;

  constructor(private readonly keycloakService: KeycloakService) {}

  async listResource(policyName: string) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      const listResource = await keycloakClient.clients.listResources({
        id: this.keycloakClientId,
      });

      const finalResource: Array<Record<string, unknown>> = [];

      for (const element of listResource) {
        const permissions = await keycloakClient.clients.findPermissions({
          id: this.keycloakClientId,
          resource: element.name,
        });

        const permissionName: string[] = [];

        for (const permission of permissions) {
          const policy = await keycloakClient.clients.getAssociatedPolicies({
            id: this.keycloakClientId,
            permissionId: permission.id!,
          });

          const scopes = await keycloakClient.clients.getAssociatedScopes({
            id: this.keycloakClientId,
            permissionId: permission.id!,
          });

          const foundPolicy = policy.find((value) => value.name === policyName);

          if (foundPolicy) {
            permissionName.push(scopes[0].name);
          }
        }

        finalResource.push({ ...element, permissions: permissionName });
      }

      return finalResource;
    }
  }

  async createResource(payload: ResourceRepresentation) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      return await keycloakClient.clients.createResource(
        { id: this.keycloakClientId },
        payload,
      );
    }
  }

  async updateResource(payload: ResourceRepresentation) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();
      return await keycloakClient.clients.updateResource(
        { id: this.keycloakClientId, resourceId: payload._id! },
        payload,
      );
    }
  }

  async deleteScope(payload: ResourceRepresentation) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      return await keycloakClient.clients.delResource({
        id: this.keycloakClientId,
        resourceId: payload._id!,
      });
    }
  }
}
