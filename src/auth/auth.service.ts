import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';

const COOKIE_NAME = 'abron_refresh';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private publicUser(user: { id: string; email: string; role: string }) {
    return { id: user.id, email: user.email, role: user.role };
  }

  private setRefreshCookie(reply: FastifyReply, token: string) {
    const days = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') ?? 7);
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: days * 24 * 60 * 60,
    });
  }

  private async issueTokens(user: { id: string; email: string; role: string }, reply: FastifyReply) {
    const sessionId = randomUUID();
    const days = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') ?? 7);
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, sid: sessionId, kind: 'refresh' },
      { secret: this.config.getOrThrow('JWT_REFRESH_SECRET'), expiresIn: `${days}d` },
    );
    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, kind: 'access' },
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('ACCESS_TOKEN_TTL') ?? '15m',
      },
    );
    this.setRefreshCookie(reply, refreshToken);
    return { accessToken, user: this.publicUser(user) };
  }

  async login(email: string, password: string, reply: FastifyReply) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user?.isActive || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user, reply);
  }

  async refresh(token: string | undefined, reply: FastifyReply) {
    if (!token) throw new UnauthorizedException('Refresh session missing');
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
      if (payload.kind !== 'refresh') throw new Error();
      const session = await this.prisma.refreshSession.findUnique({
        where: { id: payload.sid },
        include: { user: true },
      });
      if (
        !session || session.revokedAt || session.expiresAt <= new Date() ||
        session.tokenHash !== this.hash(token) || !session.user.isActive
      ) throw new Error();
      await this.prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      return this.issueTokens(session.user, reply);
    } catch {
      reply.clearCookie(COOKIE_NAME, { path: '/api/v1/auth' });
      throw new UnauthorizedException('Invalid or expired refresh session');
    }
  }

  async logout(token: string | undefined, reply: FastifyReply) {
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync(token, {
          secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        });
        await this.prisma.refreshSession.updateMany({
          where: { id: payload.sid, revokedAt: null }, data: { revokedAt: new Date() },
        });
      } catch { /* Clearing the cookie is still a successful logout. */ }
    }
    reply.clearCookie(COOKIE_NAME, { path: '/api/v1/auth' });
    return { success: true };
  }
}
