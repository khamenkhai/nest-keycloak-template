import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'nest-keycloak-connect';
import { RbacService } from './rbac.service';
import { AssignPermissionsDto, RemovePermissionsDto } from './dto';

@ApiTags('RBAC')
@ApiBearerAuth('Authorization')
@Controller()
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

  @Get('group-permissions')
  @Public()
  @ApiOperation({ summary: 'Get permissions assigned to a group' })
  getGroupPermissions(@Query('groupName') groupName: string) {
    return this.rbacService.getGroupPermissions(groupName);
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
