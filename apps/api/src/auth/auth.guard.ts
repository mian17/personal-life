import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.API_TOKEN;
    if (!token) throw new UnauthorizedException('API_TOKEN not configured');
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const [scheme, value] = header.split(' ');
    if (scheme !== 'Bearer' || value !== token) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
