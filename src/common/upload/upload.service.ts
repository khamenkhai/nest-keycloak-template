import {
  S3Client,
  CopyObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

@Injectable()
export class UploadService {
  private readonly s3client: S3Client;
  private readonly logger = new Logger(UploadService.name);
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow('MINIO_BUCKET');
    this.s3client = new S3Client({
      region: 'us-east-1',
      endpoint: this.configService.getOrThrow('MINIO_ENDPOINT'),
      credentials: {
        accessKeyId: this.configService.getOrThrow('MINIO_ACCESS_KEY'),
        secretAccessKey: this.configService.getOrThrow('MINIO_SECRET_KEY'),
      },
      forcePathStyle: true,
    });
  }

  /**
   * CREATE / UPDATE
   * Uploads a file. If the key already exists, it overwrites it.
   */
  async uploadFile(
    fileName: string,
    file: Buffer | Uint8Array | Readable,
    contentType: string,
    path: string,
  ): Promise<{ key: string }> {
    const key = this.buildKey(path, fileName);

    const upload = new Upload({
      client: this.s3client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: contentType,
      },
    });

    await upload.done();
    return { key };
  }

  /**
   * COPY
   * Copies an existing object to a new key under `path`, server-side — the
   * bytes never travel through this process.
   *
   * Used when an object has to live under a different prefix than the one it
   * was uploaded to: a shop's SKU photo becoming a master catalogue image, for
   * instance, where referencing the shop's key would leave the catalogue
   * pointing at a file the shop can delete.
   */
  async copyFile(sourceKey: string, path: string): Promise<{ key: string }> {
    const key = this.buildKey(path, sourceKey.split('/').pop() || 'file');

    try {
      await this.s3client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: key,
          // The source is bucket-qualified and URI-encoded: a key with spaces
          // or non-ASCII characters is rejected raw.
          CopySource: encodeURI(`${this.bucket}/${sourceKey}`),
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to copy ${sourceKey} to ${key}`, error);
      throw new InternalServerErrorException('Could not copy file in storage');
    }

    return { key };
  }

  /** The key layout every write here shares: `<path>/<timestamp>-<name>`. */
  private buildKey(path: string, fileName: string): string {
    const cleanPath = path.replace(/^\/|\/$/g, '');

    // to replace space and characters in the file name to avoid risky
    const sanitizedFileName = fileName
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9.-]/g, '');

    return `${cleanPath}/${Date.now()}-${sanitizedFileName}`;
  }

  /**
   * READ (Presigned URL)
   * Generates a temporary link for the frontend to view the file.
   */
  async getPresignedUrl(key: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      return await getSignedUrl(this.s3client, command, { expiresIn: 43200 });
    } catch (error) {
      this.logger.error(`Could not generate URL for key: ${key}`, error);
      return '';
    }
  }

  /**
   * READ (File Info / Existence)
   * Check if a file actually exists in the bucket.
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3client.send(command);
      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to check file existence for ${key}. Error: ${errMsg}`,
      );
      return false;
    }
  }

  /**
   * DELETE
   * Removes a file from the bucket.
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3client.send(command);
      this.logger.log(`File deleted successfully: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete file: ${key}`, error);
      throw new InternalServerErrorException(
        'Could not remove file from storage',
      );
    }
  }
}
