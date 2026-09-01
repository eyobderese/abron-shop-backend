import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Authentication required');

    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
      if (payload.kind !== 'access') throw new Error('Wrong token type');
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user?.isActive) throw new Error('Inactive user');
      request.user = { id: user.id, email: user.email, role: user.role };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}
