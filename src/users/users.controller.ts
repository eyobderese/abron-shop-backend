import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../database/prisma.service';
import { CreateUserDto, UpdateUserDto } from './users.dto';

function userJson(user: {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    is_active: user.isActive,
    last_login_at: user.lastLoginAt,
    created_at: user.createdAt,
  };
}

/** Team management: only full admins can create accounts or change roles. */
@Controller('admin/users')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(userJson);
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('A user with this email already exists');
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        role: dto.role,
        passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
      },
    });
    return userJson(user);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: { user: { id: string } },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const isSelf = user.id === req.user.id;
    if (isSelf && dto.is_active === false) throw new BadRequestException('You cannot deactivate your own account');
    if (isSelf && dto.role && dto.role !== user.role) throw new BadRequestException('You cannot change your own role');

    // Never leave the shop without an active admin.
    const losingAdmin =
      user.role === 'ADMIN' && user.isActive &&
      ((dto.role && dto.role !== 'ADMIN') || dto.is_active === false);
    if (losingAdmin) {
      const activeAdmins = await this.prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (activeAdmins <= 1) throw new BadRequestException('There must be at least one active admin');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id },
        data: {
          ...(dto.role && { role: dto.role }),
          ...(dto.is_active !== undefined && { isActive: dto.is_active }),
          ...(dto.password && { passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }) }),
        },
      });
      // Deactivating or resetting a password signs the user out everywhere.
      if (dto.is_active === false || dto.password) {
        await tx.refreshSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return row;
    });
    return userJson(updated);
  }
}
