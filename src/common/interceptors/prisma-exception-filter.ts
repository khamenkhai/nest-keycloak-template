import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { request, Response } from 'express';
import { Prisma } from 'src/database/generated/client/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaClientExceptionFilter extends BaseExceptionFilter {
  /**
   * Extracts field names for Unique Constraint (P2002)
   */
  private extractUniqueConstraintFields(
    exception: Prisma.PrismaClientKnownRequestError,
  ): string[] {
    if (exception.meta?.target) {
      if (Array.isArray(exception.meta.target)) {
        return exception.meta.target as string[];
      }
      if (typeof exception.meta.target === 'string') {
        return [exception.meta.target];
      }
    }

    const messageMatch = exception.message.match(/fields: \(`(.*?)`\)/);
    if (messageMatch && messageMatch[1]) {
      return messageMatch[1].split('`,`');
    }

    return ['field'];
  }

  /**
   * Refined logic for Foreign Key Violation (P2003)
   * Specifically handles Driver Adapter metadata and clean string formatting
   */
  private extractForeignKeyField(
    exception: Prisma.PrismaClientKnownRequestError,
  ): string {
    // 1. Check standard Prisma meta
    if (exception.meta?.field_name) {
      return (exception.meta.field_name as string)
        .replace('_id', '')
        .replace('_', ' ');
    }

    // 2. Handle Driver Adapter (Postgres/fkey constraints)
    // Extracts 'category_id' from 'sku_masters_category_id_fkey'
    const driverError = (exception.meta?.driverAdapterError as any)?.cause
      ?.constraint?.index;
    if (driverError && typeof driverError === 'string') {
      const parts = driverError.split('_');
      if (parts.length >= 3) {
        // Removes table prefix and 'fkey' suffix
        return parts
          .slice(parts.length - 3, parts.length - 1)
          .join(' ')
          .replace('id', '')
          .trim();
      }
      return driverError;
    }

    // 3. Fallback to Regex
    const match = exception.message.match(/field: `(.*?)`/);
    return match ? match[1].replace('_id', '') : 'referenced record';
  }

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    switch (exception.code) {
      case 'P2002': {
        const status = HttpStatus.CONFLICT;
        const targetFields = this.extractUniqueConstraintFields(exception);

        response.status(status).json({
          statusCode: status,
          error: 'Conflict',
          message: `Record with this ${targetFields.join(', ')} already exists.`,
        });
        break;
      }

      case 'P2003': {
        const status = HttpStatus.BAD_REQUEST;
        const fieldName = this.extractForeignKeyField(exception);

        // Check if the current request is a DELETE operation
        const isDeleteOp = request.method === 'DELETE';

        // Or check if the error message contains keywords like "delete"
        const isDeleteMsg = exception.message.toLowerCase().includes('delete');

        let message = `The provided ${fieldName} ID does not exist in the database.`;
        let errorTitle = 'Foreign Key Violation';

        if (isDeleteOp || isDeleteMsg) {
          errorTitle = 'Dependency Conflict';
          message = `Cannot delete this ${fieldName} because other records depend on it. Please remove dependent items first.`;
        }

        response.status(status).json({
          statusCode: status,
          error: errorTitle,
          message: message,
        });
        break;
      }

      case 'P2025': {
        const status = HttpStatus.NOT_FOUND;
        response.status(status).json({
          statusCode: status,
          error: 'Not Found',
          message: exception.meta?.cause || 'Record not found.',
        });
        break;
      }

      default:
        // Fallback to default NestJS error handler for codes we haven't mapped
        super.catch(exception, host);
        break;
    }
  }
}
