import { existsSync, mkdirSync } from 'fs';
import { diskStorage, memoryStorage } from 'multer';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { BadRequestException } from '@nestjs/common';

export enum StorageType {
  LOCAL = 'LOCAL',
  CLOUD = 'CLOUD',
}

export const ACTIVE_STORAGE_TYPE = StorageType.CLOUD;

// Helper for local disk configuration
const diskStorageConfig = diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './public/uploads';
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, sanitizeFileName(file.originalname));
  },
});

export const multerOptions: MulterOptions = {
  storage:
    ACTIVE_STORAGE_TYPE === StorageType.CLOUD
      ? memoryStorage()
      : diskStorageConfig,

  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException('Only JPEG, PNG, and GIF files are allowed'),
        false,
      );
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
};

export const sanitizeFileName = (originalName: string): string => {
  const fileExt = originalName.split('.').pop();
  const nameWithoutExt = originalName.split('.').slice(0, -1).join('.');

  const sanitizedName = nameWithoutExt
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_{2,}/g, '_');

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);

  return `${uniqueSuffix}-${sanitizedName}.${fileExt}`;
};
