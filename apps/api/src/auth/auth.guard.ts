import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { featureFlags } from '../config/feature-flags.js';
import { PUBLIC_ROUTE, REQUIRED_ROLES } from './auth.decorators.js';
import type { AppRole, RequestIdentity } from './auth.types.js';

type AuthRequest = { headers: Record<string, string | string[] | undefined>; identity?: RequestIdentity };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks = env.OIDC_JWKS_URL ? createRemoteJWKSet(new URL(env.OIDC_JWKS_URL)) : undefined;
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    request.identity = env.AUTH_ENABLED ? await this.verifyOidc(request) : this.localIdentity(request);
    const required = this.reflector.getAllAndOverride<AppRole[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]) ?? ['USER'];
    if (!required.some(role => request.identity?.roles.includes(role) || request.identity?.roles.includes('ADMIN'))) {
      throw new ForbiddenException('Your account is not authorized for this operation.');
    }
    return true;
  }

  private async verifyOidc(request: AuthRequest): Promise<RequestIdentity> {
    const authorization = this.header(request, 'authorization');
    if (!authorization?.startsWith('Bearer ') || !this.jwks || !env.OIDC_ISSUER || !env.OIDC_AUDIENCE) {
      throw new UnauthorizedException('A valid SSO access token is required.');
    }
    try {
      const { payload } = await jwtVerify(authorization.slice(7), this.jwks, { issuer: env.OIDC_ISSUER, audience: env.OIDC_AUDIENCE, algorithms: ['RS256', 'ES256'] });
      return this.identityFromClaims(payload);
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException('The SSO access token is invalid or expired.');
    }
  }

  private identityFromClaims(payload: JWTPayload): RequestIdentity {
    const actorId = typeof payload.sub === 'string' ? payload.sub : undefined;
    const tenant = payload[env.OIDC_TENANT_CLAIM];
    const rawRoles = payload[env.OIDC_ROLES_CLAIM];
    if (!actorId || typeof tenant !== 'string' || tenant.length === 0) throw new UnauthorizedException('The SSO token is missing required identity claims.');
    const source = Array.isArray(rawRoles) ? rawRoles : typeof rawRoles === 'string' ? rawRoles.split(/[ ,]+/) : [];
    const roles = source.filter((role): role is AppRole => ['USER', 'EVALUATOR', 'ADMIN'].includes(String(role)));
    if (roles.length === 0) throw new ForbiddenException('The SSO account has no application role.');
    return { actorId, tenantId: tenant, roles, authType: 'OIDC' };
  }

  private localIdentity(request: AuthRequest): RequestIdentity {
    if (featureFlags.FEATURE_DEV_IDENTITY) return { actorId: this.header(request, 'x-dev-actor-id') ?? 'local-user', tenantId: this.header(request, 'x-dev-tenant-id') ?? 'local-tenant', roles: ['ADMIN'], authType: 'LOCAL' };
    return { actorId: 'anonymous-local', tenantId: 'local', roles: ['USER'], authType: 'LOCAL' };
  }

  private header(request: AuthRequest, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
