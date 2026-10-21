import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { errors } from 'oidc-provider';
import { GENERIC_LOGIN_ERROR, verifyCredentials } from './credentials';
import { LoginDto } from './dto/login.dto';
import { SESSION_COOKIE, readSessionToken, sessionCookieOptions } from './cookies';
import { secureCookie } from './dev-stack';
import { loginPage } from './login.view';
import { SessionsService } from '../sessions/sessions.service';
import { OidcService } from '../oidc/oidc.service';
import { UsersService } from '../users/users.service';

const { SessionNotFound } = errors;

/**
 * Bridges oidc-provider's `login` prompt to the Task 3 login. There is no second
 * login UI: an unauthenticated authorize request lands here, we render the same
 * login form, and on success we finish the interaction with the account id. A
 * valid IdP session (Task 3 cookie) short-circuits the form and finishes the
 * interaction immediately, so the flow resumes without re-login.
 */
@Controller('interaction')
export class InteractionController {
  constructor(
    private readonly oidc: OidcService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  @Get(':uid')
  async show(@Param('uid') uid: string, @Req() req: Request, @Res() res: Response) {
    const provider = this.oidc.provider();
    let details;
    try {
      details = await provider.interactionDetails(req, res);
    } catch (err) {
      return this.expired(err, res);
    }

    if (details.prompt.name !== 'login') {
      // Consent and every other prompt are out of scope (single-user, no consent).
      return this.expired(new Error(`unsupported prompt: ${details.prompt.name}`), res);
    }

    const user = await this.sessions.findValid(readSessionToken(req.headers.cookie));
    if (user) {
      await provider.interactionFinished(
        req,
        res,
        { login: { accountId: user.id, ts: Math.floor(Date.now() / 1000) } },
        { mergeWithLastSubmission: false },
      );
      return;
    }

    res.type('html').status(200).send(loginPage(undefined, `/interaction/${uid}`));
  }

  @Post(':uid')
  async submit(
    @Param('uid') uid: string,
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const provider = this.oidc.provider();
    try {
      const details = await provider.interactionDetails(req, res);
      if (details.prompt.name !== 'login') {
        throw new Error(`unsupported prompt: ${details.prompt.name}`);
      }
    } catch (err) {
      return this.expired(err, res);
    }

    const user = await verifyCredentials(this.users, dto.username, dto.password);
    if (!user) {
      res.type('html').status(401).send(loginPage(GENERIC_LOGIN_ERROR, `/interaction/${uid}`));
      return;
    }

    // Establish the Task 3 session, then hand the account to the provider so the
    // authorization request resumes (303 back to the authorization endpoint).
    const token = await this.sessions.create(user);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(secureCookie()));
    await provider.interactionFinished(
      req,
      res,
      { login: { accountId: user.id, ts: Math.floor(Date.now() / 1000) } },
      { mergeWithLastSubmission: false },
    );
  }

  /** Expired/unknown interaction (or an unexpected prompt): fail closed with 400. */
  private expired(err: unknown, res: Response): void {
    if (err instanceof SessionNotFound || (err instanceof Error && /interaction/.test(err.message))) {
      res.status(400).type('text/plain').send('interaction expired or invalid');
      return;
    }
    res.status(500).type('text/plain').send('interaction error');
  }
}
