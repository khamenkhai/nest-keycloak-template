import { Injectable } from '@nestjs/common';
import { KeycloakService } from './keycloak.service';
import {
  DecisionStrategy,
  Logic,
} from '@keycloak/keycloak-admin-client/lib/defs/policyRepresentation';

@Injectable()
export class KeycloakPolicyService {
  private readonly keycloakClientId: string = process.env.CLIENT_KEYCLOAK_ID!;

  constructor(private readonly keycloakService: KeycloakService) {}

  async createPolicy(
    keycloakGroupId: string,
    name: string,
    description: string,
  ) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      return await keycloakClient.clients.createPolicy(
        {
          id: this.keycloakClientId,
          type: '',
        },
        {
          name,
          description,
          type: 'group',
          logic: Logic.POSITIVE,
          decisionStrategy: DecisionStrategy.AFFIRMATIVE,
          config: {
            groups: JSON.stringify([
              {
                id: keycloakGroupId,
                extendChildren: false,
              },
            ]),
          },
        },
      );
    }
  }

  async updatePolicy(
    keycloakGroupId: string,
    name: string,
    description: string,
  ) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      const policy = await keycloakClient.clients.findPolicyByName({
        id: this.keycloakClientId,
        name,
      });

      if (policy) {
        return await keycloakClient.clients.updatePolicy(
          {
            id: this.keycloakClientId,
            type: '',
            policyId: policy.id!,
          },
          {
            name,
            description,
            type: 'group',
            logic: Logic.POSITIVE,
            decisionStrategy: DecisionStrategy.AFFIRMATIVE,
            config: {
              groups: JSON.stringify([
                {
                  id: keycloakGroupId,
                  extendChildren: false,
                },
              ]),
            },
          },
        );
      }
    }
  }

  async deletePolicy(name: string) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      const policy = await keycloakClient.clients.findPolicyByName({
        id: this.keycloakClientId,
        name,
      });

      if (policy) {
        return await keycloakClient.clients.delPolicy({
          id: this.keycloakClientId,
          policyId: policy.id!,
        });
      }
    }
  }
}
