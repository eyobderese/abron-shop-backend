import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateMarketerDto,
  CreatePayoutDto,
  CreatePromoCodeDto,
  OpenDisputeDto,
  PromoVisitDto,
  ResolveDisputeDto,
  UpdateMarketerDto,
  UpdatePromoCodeDto,
  ValidatePromoDto,
} from './promo.dto';
import { PromoService } from './promo.service';

export function adminActor(req: { user?: { email?: string } }) {
  return `admin:${req.user?.email ?? 'unknown'}`;
}

@Controller()
export class PromoPublicController {
  constructor(private readonly promo: PromoService) {}

  @Post('promo-codes/validate')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  validate(@Body() dto: ValidatePromoDto) {
    return this.promo.validate(dto.code, dto.product_id);
  }

  @Post('promo-codes/visit')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  visit(@Body() dto: PromoVisitDto) {
    return this.promo.recordVisit(dto.code);
  }

  @Get('partner/:token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  portal(@Param('token') token: string) {
    return this.promo.portal(token);
  }

  @Post('partner/:token/disputes')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  openDispute(@Param('token') token: string, @Body() dto: OpenDisputeDto) {
    return this.promo.portalOpenDispute(token, dto);
  }
}

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class PromoAdminController {
  constructor(private readonly promo: PromoService) {}

  @Get('promo/settings')
  settings() {
    return this.promo.terms();
  }

  @Get('marketers')
  listMarketers() {
    return this.promo.listMarketers();
  }

  @Post('marketers')
  async createMarketer(@Body() dto: CreateMarketerDto, @Req() req: any) {
    const { marketer, portal_url } = await this.promo.createMarketer(dto, adminActor(req));
    return { ...this.promo.marketerJson(marketer), portal_url };
  }

  @Get('marketers/:id')
  marketerDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.promo.marketerDetail(id);
  }

  @Patch('marketers/:id')
  async updateMarketer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMarketerDto, @Req() req: any) {
    return this.promo.marketerJson(await this.promo.updateMarketer(id, dto, adminActor(req)));
  }

  @Post('marketers/:id/portal-link')
  regenerateLink(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.promo.regeneratePortalLink(id, adminActor(req));
  }

  @Post('marketers/:id/payouts')
  payout(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePayoutDto, @Req() req: any) {
    return this.promo.createPayout(id, dto, adminActor(req));
  }

  @Post('promo-codes')
  createCode(@Body() dto: CreatePromoCodeDto, @Req() req: any) {
    return this.promo.createCode(dto, adminActor(req));
  }

  @Patch('promo-codes/:id')
  updateCode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePromoCodeDto, @Req() req: any) {
    return this.promo.updateCode(id, dto, adminActor(req));
  }

  @Get('disputes')
  disputes() {
    return this.promo.listDisputes();
  }

  @Post('disputes/:id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDisputeDto, @Req() req: any) {
    return this.promo.resolveDispute(id, dto, adminActor(req));
  }
}
