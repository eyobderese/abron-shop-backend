import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

@Injectable()
export class MediaService {
  constructor(private readonly config: ConfigService) {}

  private safeFolder(folder?: string) {
    return ['products', 'categories', 'ads'].includes(folder ?? '') ? folder! : 'misc';
  }

  private objectKey(extension: string, folder?: string) {
    return `${this.safeFolder(folder)}/${Date.now()}-${randomUUID()}${extension}`;
  }

  private numericSetting(name: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get(name) ?? fallback);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  }

  private async optimizeImage(buffer: Buffer) {
    const maxDimension = this.numericSetting('IMAGE_MAX_DIMENSION', 1600, 640, 2560);
    const quality = this.numericSetting('IMAGE_WEBP_QUALITY', 82, 60, 95);

    try {
      return await sharp(buffer, {
        animated: true,
        failOn: 'error',
        limitInputPixels: 40_000_000,
      })
        .rotate()
        .resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality, effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new BadRequestException('The uploaded image is invalid or too large to process');
    }
  }

  async upload(file: { filename: string; mimetype: string; toBuffer(): Promise<Buffer> }, folder?: string) {
    const allowedTypes = new Set([
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
      'video/mp4', 'video/webm',
    ]);
    if (!allowedTypes.has(file.mimetype)) {
      throw new BadRequestException('Only image and video files are accepted');
    }
    const buffer = await file.toBuffer();
    const max = file.mimetype.startsWith('video/') ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
    if (buffer.length > max) throw new BadRequestException('Uploaded file is too large');
    const isImage = file.mimetype.startsWith('image/');
    const optimized = isImage ? await this.optimizeImage(buffer) : null;
    const output = optimized?.data ?? buffer;
    const extension = isImage ? '.webp' : file.mimetype === 'video/mp4' ? '.mp4' : '.webm';
    const key = this.objectKey(extension, folder);

    const base = resolve(this.config.get('MEDIA_LOCAL_DIR') ?? 'uploads');
    const target = join(base, key);
    await mkdir(join(base, this.safeFolder(folder)), { recursive: true });
    await writeFile(target, output);
    return {
      key,
      url: `${this.config.getOrThrow('MEDIA_PUBLIC_URL').replace(/\/$/, '')}/${key}`,
      content_type: isImage ? 'image/webp' : file.mimetype,
      original_bytes: buffer.length,
      stored_bytes: output.length,
      ...(optimized && { width: optimized.info.width, height: optimized.info.height }),
    };
  }

  async remove(key: string) {
    if (key.includes('..') || key.startsWith('/')) throw new BadRequestException('Invalid media key');
    const base = resolve(this.config.get('MEDIA_LOCAL_DIR') ?? 'uploads');
    await unlink(join(base, key)).catch(() => undefined);
    return { success: true };
  }
}
