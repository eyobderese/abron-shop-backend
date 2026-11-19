import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ROLES_KEY, STAFF_ROLES } from './roles.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Authentication required');

    let user: { id: string; email: string; role: UserRole };
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
      if (payload.kind !== 'access') throw new Error('Wrong token type');
      const row = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!row?.isActive) throw new Error('Inactive user');
      user = { id: row.id, email: row.email, role: row.role };
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
    request.user = user;

    // The role is read from the database on every request, so a role change or
    // deactivation takes effect immediately.
    const allowed =
      this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? STAFF_ROLES;
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException('Your account does not have access to this section');
    }
    return true;
  }
}
