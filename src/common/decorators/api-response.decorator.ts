import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

export function ApiInterceptedResponse(
  statusCode: HttpStatus,
  description: string,
  dataSchema?: any,
) {
  const baseResponse = {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Data retrieved successfully' },
    timestamp: { type: 'string', example: '2024-10-09T12:00:00.000Z' },
    path: { type: 'string', example: '/api/v1/endpoint' },
  };

  return applyDecorators(
    ApiResponse({
      status: statusCode,
      description,
      schema: {
        type: 'object',
        properties: {
          ...baseResponse,
          data: dataSchema || { type: 'object' },
        },
      },
    }),
  );
}

export function ApiPaginatedResponse(
  description: string,
  itemSchema: any,
  pathExample: string = '/api/v1/endpoint',
) {
  const isClass = typeof itemSchema === 'function';

  return applyDecorators(
    ...(isClass ? [ApiExtraModels(itemSchema)] : []),
    ApiResponse({
      status: HttpStatus.OK,
      description,
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Data retrieved successfully' },
          data: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: isClass
                  ? { $ref: getSchemaPath(itemSchema) }
                  : itemSchema,
              },
              total: { type: 'number', example: 42 },
              page: { type: 'number', example: 1 },
              lastPage: { type: 'number', example: 5 },
            },
          },
          timestamp: { type: 'string', example: '2024-10-09T12:00:00.000Z' },
          path: { type: 'string', example: pathExample },
        },
      },
    }),
  );
}

export function ApiListResponse(
  description: string,
  itemSchema: any,
  pathExample: string = '/api/v1/endpoint',
  message: string = 'Data retrieved successfully',
) {
  const isClass = typeof itemSchema === 'function';

  return applyDecorators(
    ...(isClass ? [ApiExtraModels(itemSchema)] : []),
    ApiResponse({
      status: HttpStatus.OK,
      description,
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: message },
          data: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: isClass
                  ? { $ref: getSchemaPath(itemSchema) }
                  : itemSchema,
              },
            },
          },
          timestamp: { type: 'string', example: '2024-10-09T12:00:00.000Z' },
          path: { type: 'string', example: pathExample },
        },
      },
    }),
  );
}

export function ApiSingleResponse(
  description: string,
  itemSchema: any,
  pathExample: string = '/api/v1/endpoint',
  statusCode: HttpStatus = HttpStatus.OK,
  message: string = 'Data retrieved successfully',
) {
  const isClass = typeof itemSchema === 'function';

  return applyDecorators(
    ...(isClass ? [ApiExtraModels(itemSchema)] : []),
    ApiResponse({
      status: statusCode,
      description,
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: message },
          data: {
            type: 'object',
            properties: {
              data: isClass ? { $ref: getSchemaPath(itemSchema) } : itemSchema,
            },
          },
          timestamp: { type: 'string', example: '2024-10-09T12:00:00.000Z' },
          path: { type: 'string', example: pathExample },
        },
      },
    }),
  );
}
