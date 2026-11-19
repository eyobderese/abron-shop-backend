import { BadRequestException, Controller, Delete, ForbiddenException, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProductEditorAllowed } from '../auth/roles.decorator';
import { MediaService } from './media.service';

@Controller('admin/media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @ProductEditorAllowed()
  async upload(@Req() req: FastifyRequest & { user?: { role: string } }, @Query('folder') folder?: string) {
    if (req.user?.role === 'PRODUCT_EDITOR' && folder !== 'products') {
      throw new ForbiddenException('Product editors can only upload product images');
    }
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
