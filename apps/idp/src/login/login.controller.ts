import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LoginDto } from './dto/login.dto';
import { GENERIC_LOGIN_ERROR, verifyCredentials } from './credentials';
import { SESSION_COOKIE, readSessionToken, sessionCookieOptions } from './cookies';
import { homePage, loginPage } from './login.view';
import { SessionsService } from '../sessions/sessions.service';
import { UsersService } from '../users/users.service';

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
    const user = await verifyCredentials(this.users, dto.username, dto.password);
    if (!user) {
      res.type('html').status(401).send(loginPage(GENERIC_LOGIN_ERROR));
      return;
    }

    const token = await this.sessions.create(user);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    res.type('html').status(200).send(homePage(user.username));
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
