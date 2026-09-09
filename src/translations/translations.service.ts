import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type TargetLanguage = 'am' | 'om';

type GoogleTranslationResponse = {
  data?: {
    translations?: Array<{ translatedText?: string }>;
  };
};

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };
  return value
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => named[entity] ?? entity)
    .replace(/&#(\d+);/g, (entity, code) => {
      const value = Number(code);
      return Number.isInteger(value) && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : entity;
    })
    .replace(/&#x([\da-f]+);/gi, (entity, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isInteger(value) && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : entity;
    });
}

@Injectable()
export class TranslationsService {
  constructor(private readonly config: ConfigService) {}

  private apiKey() {
    const apiKey = this.config.get<string>('GOOGLE_TRANSLATE_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('Translation service is not configured');
    }
    return apiKey;
  }

  private async translate(
    name: string,
    description: string,
    targetLanguage: TargetLanguage,
  ) {
    let response: Response;
    try {
      response = await fetch('https://translation.googleapis.com/language/translate/v2', {
        method: 'POST',
        headers: {
          'X-Goog-Api-Key': this.apiKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: [name, description],
          source: 'en',
          target: targetLanguage,
          format: 'text',
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ServiceUnavailableException('Translation provider is unavailable');
    }

    let payload: GoogleTranslationResponse;
    try {
      payload = await response.json() as GoogleTranslationResponse;
    } catch {
      throw new BadGatewayException('Translation provider returned an invalid response');
    }

    const translations = payload.data?.translations;
    if (
      !response.ok
      || translations?.length !== 2
      || translations.some((translation) => !translation.translatedText?.trim())
    ) {
      throw new BadGatewayException('Translation provider could not generate a draft');
    }
    return {
      name: decodeHtmlEntities(translations[0].translatedText!.trim()),
      description: decodeHtmlEntities(translations[1].translatedText!.trim()),
    };
  }

  async translateProductDraft(
    name: string,
    description: string,
    targetLanguage: TargetLanguage,
  ) {
    return this.translate(name.trim(), description.trim(), targetLanguage);
  }
}
