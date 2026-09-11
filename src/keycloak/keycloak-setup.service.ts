import { Injectable, Logger } from '@nestjs/common';
import { KeycloakService } from './keycloak.service';

export interface SetupResult {
  scopes: string[];
  resources: string[];
  policies: string[];
  permissions: string[];
}

@Injectable()
export class KeycloakSetupService {
  private readonly logger = new Logger(KeycloakSetupService.name);
  private readonly keycloakClientId: string = process.env.KEYCLOAK_CLIENT_ID!;
  private readonly adminGroupId: string = process.env.KEYCLOAK_ADMIN_GROUP_ID!;
  private readonly userGroupId: string = process.env.KEYCLOAK_USER_GROUP_ID!;

  private readonly scopes = ['create', 'read', 'update', 'delete'];
  private readonly resources = [
    { name: 'Posts', displayName: 'Posts Resource' },
    { name: 'Categories', displayName: 'Categories Resource' },
  ];

  constructor(private readonly keycloakService: KeycloakService) {}

  async setup(): Promise<SetupResult> {
    if (!this.keycloakService.isConfigured()) {
      throw new Error('Keycloak is not configured');
    }

    await this.keycloakService.authenticate();
    const client = this.keycloakService.getClient();

    // Find the internal UUID for the client by its clientId string
    const clients = await client.clients.find({
      clientId: this.keycloakClientId,
    });
    if (!clients.length) {
      throw new Error(
        `Client "${this.keycloakClientId}" not found in Keycloak`,
      );
    }
    const clientUuid = clients[0].id!;

    const createdScopes: string[] = [];
    const createdResources: string[] = [];
    const createdPolicies: string[] = [];
    const createdPermissions: string[] = [];

    // 1. Create scopes
    this.logger.log('Creating authorization scopes...');
    for (const scopeName of this.scopes) {
      try {
        await client.clients.createAuthorizationScope(
          { id: clientUuid },
          { name: scopeName, displayName: scopeName },
        );
        createdScopes.push(scopeName);
        this.logger.log(`Scope "${scopeName}" created`);
      } catch (error) {
        if (error?.response?.status === 409) {
          this.logger.log(`Scope "${scopeName}" already exists, skipping`);
          createdScopes.push(scopeName);
        } else {
          this.logger.error(`Failed to create scope "${scopeName}"`, error);
        }
      }
    }

    // 2. Create resources with associated scopes
    this.logger.log('Creating authorization resources...');
    for (const resource of this.resources) {
      try {
        await client.clients.createResource(
          { id: clientUuid },
          {
            name: resource.name,
            displayName: resource.displayName,
            scopes: this.scopes.map((s) => ({ name: s })),
          },
        );
        createdResources.push(resource.name);
        this.logger.log(`Resource "${resource.name}" created`);
      } catch (error) {
        if (error?.response?.status === 409) {
          this.logger.log(
            `Resource "${resource.name}" already exists, skipping`,
          );
          createdResources.push(resource.name);
        } else {
          this.logger.error(
            `Failed to create resource "${resource.name}"`,
            error,
          );
        }
      }
    }

    // 3. Create group policies
    this.logger.log('Creating group policies...');
    const policies = [
      {
        name: 'admin-group-policy',
        description: 'Policy for admin group members',
        groupId: this.adminGroupId,
      },
      {
        name: 'user-group-policy',
        description: 'Policy for user group members',
        groupId: this.userGroupId,
      },
    ];

    for (const policy of policies) {
      try {
        await client.clients.createPolicy(
          { id: clientUuid, type: '' },
          {
            name: policy.name,
            description: policy.description,
            type: 'group',
            logic: 'POSITIVE' as any,
            decisionStrategy: 'AFFIRMATIVE' as any,
            config: {
              groups: JSON.stringify([
                { id: policy.groupId, extendChildren: false },
              ]),
            },
          },
        );
        createdPolicies.push(policy.name);
        this.logger.log(`Policy "${policy.name}" created`);
      } catch (error) {
        if (error?.response?.status === 409) {
          this.logger.log(`Policy "${policy.name}" already exists, skipping`);
          createdPolicies.push(policy.name);
        } else {
          this.logger.error(`Failed to create policy "${policy.name}"`, error);
        }
      }
    }

    // 4. Create scope-based permissions (resource + scopes + policy)
    // admin-group: full access (create, read, update, delete)
    // user-group: read-only
    this.logger.log('Creating scope-based permissions...');
    for (const resource of this.resources) {
      for (const scopeName of this.scopes) {
        const permissionName = `${resource.name} ${scopeName} permission`;
        const policies =
          scopeName === 'read'
            ? ['admin-group-policy', 'user-group-policy']
            : ['admin-group-policy'];
        try {
          await client.clients.createPermission(
            { id: clientUuid, type: 'scope' },
            {
              name: permissionName,
              description: `Grants "${scopeName}" scope on "${resource.name}"`,
              type: 'scope',
              logic: 'POSITIVE' as any,
              decisionStrategy: 'AFFIRMATIVE' as any,
              resources: [resource.name],
              scopes: [scopeName],
              policies,
            },
          );
          createdPermissions.push(permissionName);
          this.logger.log(`Permission "${permissionName}" created`);
        } catch (error) {
          if (error?.response?.status === 409) {
            this.logger.log(
              `Permission "${permissionName}" already exists, skipping`,
            );
            createdPermissions.push(permissionName);
          } else {
            this.logger.error(
              `Failed to create permission "${permissionName}"`,
              error,
            );
          }
        }
      }
    }

    this.logger.log('Keycloak authorization setup complete');

    return {
      scopes: createdScopes,
      resources: createdResources,
      policies: createdPolicies,
      permissions: createdPermissions,
    };
  }
}
