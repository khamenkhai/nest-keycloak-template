import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'nest-keycloak-connect';
import { RbacService } from './rbac.service';
import {
  AssignPermissionsDto,
  GetGroupPermissionsDto,
  RemovePermissionsDto,
} from './dto';

@ApiTags('RBAC')
@ApiBearerAuth('Authorization')
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('groups')
  @Public()
  @ApiOperation({ summary: 'List all Keycloak groups' })
  listGroups() {
    return this.rbacService.listGroups();
  }

  @Get('resources')
  @Public()
  @ApiOperation({ summary: 'List all authorization resources with scopes' })
  listResources() {
    return this.rbacService.listResources();
  }

  @Get('scopes')
  @Public()
  @ApiOperation({ summary: 'List all authorization scopes' })
  listScopes() {
    return this.rbacService.listScopes();
  }

  @Post('group-permissions')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get permissions assigned to a group' })
  getGroupPermissions(@Body() dto: GetGroupPermissionsDto) {
    return this.rbacService.getGroupPermissions(dto.groupName);
  }

  @Post('assign')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign permissions to a group for a resource' })
  assignPermissions(@Body() dto: AssignPermissionsDto) {
    return this.rbacService.assignPermissions(
      dto.groupName,
      dto.resourceName,
      dto.scopes,
    );
  }

  @Post('remove')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove permissions from a group for a resource' })
  removePermissions(@Body() dto: RemovePermissionsDto) {
    return this.rbacService.removePermissions(
      dto.groupName,
      dto.resourceName,
      dto.scopes,
    );
  }
}
