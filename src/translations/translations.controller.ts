import {
  Body,
  Controller,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProductTranslationDraftDto } from './translations.dto';
import { TranslationsService } from './translations.service';

@Controller('admin/translations')
@UseGuards(JwtAuthGuard)
export class TranslationsController {
  constructor(private readonly translations: TranslationsService) {}

  @Post('product-draft')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async productDraft(@Body() dto: ProductTranslationDraftDto) {
    const [amharic, oromo] = await Promise.allSettled([
      this.translations.translateProductDraft(dto.name, dto.description, 'am'),
      this.translations.translateProductDraft(dto.name, dto.description, 'om'),
    ]);

    if (amharic.status === 'rejected' && oromo.status === 'rejected') {
      const configurationError = [amharic.reason, oromo.reason]
        .find((reason) => reason instanceof ServiceUnavailableException);
      if (configurationError) throw configurationError;
      throw new ServiceUnavailableException('Translation drafts could not be generated');
    }

    return {
      name_am: amharic.status === 'fulfilled' ? amharic.value.name : null,
      description_am: amharic.status === 'fulfilled' ? amharic.value.description : null,
      name_or: oromo.status === 'fulfilled' ? oromo.value.name : null,
      description_or: oromo.status === 'fulfilled' ? oromo.value.description : null,
      warnings: [
        ...(amharic.status === 'rejected' ? ['Amharic draft could not be generated'] : []),
        ...(oromo.status === 'rejected' ? ['Afaan Oromo draft could not be generated'] : []),
      ],
    };
  }
}
