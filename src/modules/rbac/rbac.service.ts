import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { KeycloakService } from 'src/keycloak';

export interface GroupInfo {
  id: string;
  name: string;
  path: string;
}

export interface ResourceInfo {
  name: string;
  displayName: string;
  scopes: string[];
}

export interface GroupPermission {
  resourceName: string;
  scopes: string[];
}

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);
  private readonly keycloakClientId: string = process.env.KEYCLOAK_CLIENT_ID!;

  constructor(private readonly keycloakService: KeycloakService) {}

  private async getClientUuid(client: any): Promise<string> {
    const clients = await client.clients.find({
      clientId: this.keycloakClientId,
    });
    if (!clients.length) {
      throw new Error(
        `Client "${this.keycloakClientId}" not found in Keycloak`,
      );
    }
    return clients[0].id!;
  }

  async listGroups(): Promise<GroupInfo[]> {
    await this.ensureAuthenticated();
    const client = this.keycloakService.getClient();

    const groups = await client.groups.find();
    return groups.map((g: any) => ({
      id: g.id,
      name: g.name,
      path: g.path,
    }));
  }

  async listResources(): Promise<ResourceInfo[]> {
    await this.ensureAuthenticated();
    const client = this.keycloakService.getClient();
    const clientUuid = await this.getClientUuid(client);

    const resources = await client.clients.listResources({
      id: clientUuid,
    });

    return resources.map((r: any) => ({
      name: r.name,
      displayName: r.displayName,
      scopes: r.scopes?.map((s: any) => s.name) || [],
    }));
  }

  async listScopes(): Promise<string[]> {
    await this.ensureAuthenticated();
    const client = this.keycloakService.getClient();
    const clientUuid = await this.getClientUuid(client);

    const scopes = await client.clients.listAllScopes({
      id: clientUuid,
    });

    return scopes.map((s: any) => s.name);
  }

  async getGroupPermissions(groupName: string): Promise<GroupPermission[]> {
    await this.ensureAuthenticated();
    const client = this.keycloakService.getClient();
    const clientUuid = await this.getClientUuid(client);

    const groupId = await this.findGroupId(client, groupName);
    if (!groupId) {
      throw new NotFoundException(`Group "${groupName}" not found`);
    }

    const permissions = await client.clients.findPermissions({
      id: clientUuid,
    });

    const result: GroupPermission[] = [];

    for (const permission of permissions) {
      const associatedPolicies = await client.clients.getAssociatedPolicies({
        id: clientUuid,
        permissionId: permission.id!,
      });

      const isGroupPolicy = await this.hasMatchingGroupPolicy(
        client,
        clientUuid,
        associatedPolicies,
        groupId,
      );

      if (isGroupPolicy && permission.type === 'scope') {
        const associatedScopes = await client.clients.getAssociatedScopes({
          id: clientUuid,
          permissionId: permission.id!,
        });

        const resourceName = permission.resources?.[0] || '';
        const scopes = associatedScopes.map((s: any) => s.name);

        const existing = result.find((r) => r.resourceName === resourceName);
        if (existing) {
          existing.scopes.push(...scopes);
        } else {
          result.push({ resourceName, scopes });
        }
      }
    }

    return result;
  }

  async assignPermissions(
    groupName: string,
    resourceName: string,
    scopes: string[],
  ): Promise<{ success: boolean; message: string }> {
    await this.ensureAuthenticated();
    const client = this.keycloakService.getClient();
    const clientUuid = await this.getClientUuid(client);

    const groupId = await this.findGroupId(client, groupName);
    if (!groupId) {
      throw new NotFoundException(`Group "${groupName}" not found`);
    }

    const policyName = `${groupName}-policy`;

    const existingPolicy = await client.clients.findPolicyByName({
      id: clientUuid,
      name: policyName,
    });

    if (existingPolicy) {
      await client.clients.updatePolicy(
        {
          id: clientUuid,
          type: '',
          policyId: existingPolicy.id!,
        },
        {
          name: policyName,
          description: `Policy for ${groupName} members`,
          type: 'group',
          logic: 'POSITIVE' as any,
          decisionStrategy: 'AFFIRMATIVE' as any,
          config: {
            groups: JSON.stringify([{ id: groupId, extendChildren: false }]),
          },
        },
      );
    } else {
      await client.clients.createPolicy(
        { id: clientUuid, type: '' },
        {
          name: policyName,
          description: `Policy for ${groupName} members`,
          type: 'group',
          logic: 'POSITIVE' as any,
          decisionStrategy: 'AFFIRMATIVE' as any,
          config: {
            groups: JSON.stringify([{ id: groupId, extendChildren: false }]),
          },
        },
      );
    }

    for (const scopeName of scopes) {
      const permissionName = `${resourceName} ${scopeName} permission`;

      const existingPermissions = await client.clients.findPermissions({
        id: clientUuid,
        name: permissionName,
      });
      const existingPermission = existingPermissions.find(
        (p: any) => p.name === permissionName,
      );

      if (existingPermission) {
        const associatedPolicies = await client.clients.getAssociatedPolicies({
          id: clientUuid,
          permissionId: existingPermission.id!,
        });

        const policyNames = associatedPolicies
          .map((p: any) => p.name)
          .filter((n: string) => n !== undefined);

        if (!policyNames.includes(policyName)) {
          await client.clients.updatePermission(
            {
              id: clientUuid,
              type: 'scope',
              permissionId: existingPermission.id!,
            },
            {
              ...existingPermission,
              policies: [...policyNames, policyName],
            },
          );
        }
      } else {
        await client.clients.createPermission(
          { id: clientUuid, type: 'scope' },
          {
            name: permissionName,
            description: `Grants "${scopeName}" scope on "${resourceName}"`,
            type: 'scope',
            logic: 'POSITIVE' as any,
            decisionStrategy: 'AFFIRMATIVE' as any,
            resources: [resourceName],
            scopes: [scopeName],
            policies: [policyName],
          },
        );
      }
    }

    this.logger.log(`Permissions assigned to group "${groupName}"`, {
      resourceName,
      scopes,
    });

    return {
      success: true,
      message: `Permissions assigned to group "${groupName}" for resource "${resourceName}"`,
    };
  }

  async removePermissions(
    groupName: string,
    resourceName: string,
    scopes: string[],
  ): Promise<{ success: boolean; message: string }> {
    await this.ensureAuthenticated();
    const client = this.keycloakService.getClient();
    const clientUuid = await this.getClientUuid(client);

    const groupId = await this.findGroupId(client, groupName);
    if (!groupId) {
      throw new NotFoundException(`Group "${groupName}" not found`);
    }

    const policyName = `${groupName}-policy`;

    for (const scopeName of scopes) {
      const permissionName = `${resourceName} ${scopeName} permission`;

      const permissions = await client.clients.findPermissions({
        id: clientUuid,
        name: permissionName,
      });
      const permission = permissions.find(
        (p: any) => p.name === permissionName,
      );

      if (permission) {
        const associatedPolicies = await client.clients.getAssociatedPolicies({
          id: clientUuid,
          permissionId: permission.id!,
        });

        const updatedPolicies = associatedPolicies
          .filter((p: any) => p.name !== policyName)
          .map((p: any) => p.name)
          .filter((n: string) => n !== undefined);

        if (updatedPolicies.length === 0) {
          await client.clients.delPermission({
            id: clientUuid,
            type: 'scope',
            permissionId: permission.id!,
          });
        } else {
          await client.clients.updatePermission(
            {
              id: clientUuid,
              type: 'scope',
              permissionId: permission.id!,
            },
            {
              ...permission,
              policies: updatedPolicies,
            },
          );
        }
      }
    }

    this.logger.log(`Permissions removed from group "${groupName}"`, {
      resourceName,
      scopes,
    });

    return {
      success: true,
      message: `Permissions removed from group "${groupName}" for resource "${resourceName}"`,
    };
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.keycloakService.isConfigured()) {
      throw new Error('Keycloak is not configured');
    }
    await this.keycloakService.authenticate();
  }

  private async findGroupId(
    client: any,
    groupName: string,
  ): Promise<string | null> {
    const groups = await client.groups.find({ search: groupName });
    const group = groups.find((g: any) => g.name === groupName);
    return group?.id ?? null;
  }

  private async hasMatchingGroupPolicy(
    client: any,
    clientUuid: string,
    associatedPolicies: any[],
    groupId: string,
  ): Promise<boolean> {
    for (const p of associatedPolicies) {
      if (p.type !== 'group') continue;

      const fullPolicy = await client.clients.findPolicyByName({
        id: clientUuid,
        name: p.name,
      });

      if (!fullPolicy) continue;

      const groupsConfig = fullPolicy.config?.groups;
      if (!groupsConfig) continue;

      try {
        const groups =
          typeof groupsConfig === 'string'
            ? JSON.parse(groupsConfig)
            : groupsConfig;
        if (
          Array.isArray(groups) &&
          groups.some((g: any) => g.id === groupId)
        ) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }
}
