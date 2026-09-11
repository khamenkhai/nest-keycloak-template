import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from 'nest-keycloak-connect';
import { KeycloakSetupService } from './keycloak-setup.service';

@ApiTags('Keycloak Setup')
@ApiBearerAuth('Authorization')
@Controller('keycloak')
export class KeycloakSetupController {
  constructor(private readonly keycloakSetupService: KeycloakSetupService) {}

  @Post('setup')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bootstrap Keycloak authorization resources' })
  setup() {
    return this.keycloakSetupService.setup();
  }
}
