import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import { LoginDto } from './dto/login.dto';
import { SESSION_COOKIE, readSessionToken, sessionCookieOptions } from './cookies';
import { homePage, loginPage } from './login.view';
import { SessionsService } from '../sessions/sessions.service';
import { UsersService } from '../users/users.service';

/**
 * Fixed argon2id hash of a randomly generated, discarded value. Used to spend the
 * same work when a username does not exist so failures cannot be distinguished by
 * timing. It can never match a real password. Never logged.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$lkxizgEnK3dRhXE2JX0DzA$bBc58AQgEwK8kTaTxT9JqHDhjI736aziayNvtjoq2M0';

const GENERIC_LOGIN_ERROR = 'Invalid username or password';

@Controller()
export class LoginController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  @Get('login')
  showLoginForm(@Res() res: Response) {
    res.type('html').status(200).send(loginPage());
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res() res: Response) {
    const username = dto.username?.trim() ?? '';
    const password = dto.password ?? '';

    const user = username ? await this.users.findByUsername(username) : null;

    let ok = false;
    if (user) {
      ok = await this.users.verifyPassword(user, password);
    } else {
      // Equalize timing: unknown username still pays for one argon2 verify.
      await argon2.verify(DUMMY_PASSWORD_HASH, password);
    }

    if (!ok) {
      res.type('html').status(401).send(loginPage(GENERIC_LOGIN_ERROR));
      return;
    }

    const token = await this.sessions.create(user!);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    res.type('html').status(200).send(homePage(user!.username));
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    await this.sessions.destroy(readSessionToken(req.headers.cookie));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.redirect(303, '/login');
  }

  @Get()
  async home(@Req() req: Request, @Res() res: Response) {
    const user = await this.sessions.findValid(readSessionToken(req.headers.cookie));
    if (!user) {
      res.redirect(302, '/login');
      return;
    }
    res.type('html').status(200).send(homePage(user.username));
  }
}
