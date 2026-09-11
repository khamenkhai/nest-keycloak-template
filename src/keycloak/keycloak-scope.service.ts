import { Injectable } from '@nestjs/common';
import { KeycloakService } from './keycloak.service';
import ScopeRepresentation from '@keycloak/keycloak-admin-client/lib/defs/scopeRepresentation';

interface CreateScopeResponse {
  id: string;
  name: string;
  displayName: string;
}

@Injectable()
export class KeycloakScopeService {
  private readonly keycloakClientId: string = process.env.KEYCLOAK_CLIENT_ID!;

  constructor(private readonly keycloakService: KeycloakService) {}

  async createScope(payload: ScopeRepresentation) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      return await keycloakClient.clients.createAuthorizationScope(
        { id: this.keycloakClientId },
        payload,
      );
    }
  }

  async updateScope(payload: ScopeRepresentation) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      return await keycloakClient.clients.updateAuthorizationScope(
        { id: this.keycloakClientId, scopeId: payload.id! },
        payload,
      );
    }
  }

  async deleteScope(payload: ScopeRepresentation) {
    if (this.keycloakService.isConfigured()) {
      await this.keycloakService.authenticate();

      const keycloakClient = this.keycloakService.getClient();

      return await keycloakClient.clients.delAuthorizationScope({
        id: this.keycloakClientId,
        scopeId: payload.id!,
      });
    }
  }
}
