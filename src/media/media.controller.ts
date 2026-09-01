import { BadRequestException, Controller, Delete, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaService } from './media.service';

@Controller('admin/media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  async upload(@Req() req: FastifyRequest, @Query('folder') folder?: string) {
    const file = await req.file();
    if (!file) throw new BadRequestException('A file is required');
    return this.media.upload(file, folder);
  }

  @Delete()
  remove(@Query('key') key: string) {
    if (!key) throw new BadRequestException('A media key is required');
    return this.media.remove(key);
  }
}
