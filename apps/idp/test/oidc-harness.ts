import request from 'supertest';

export interface RpcResult {
  status: number;
  location?: string;
  body: string;
  json: unknown;
  type?: string;
  /** Raw Set-Cookie headers, so tests can assert cookie clearing/flags. */
  setCookie?: string[];
}

function parseJson(text: string, type: string | undefined): unknown {
  if (!type || !type.includes('json')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Tiny cookie-jar HTTP client over a supertest/Nest HTTP server. Keeps the
 * dance helpers readable and mirrors a browser following redirects manually.
 */
export class Client {
  private readonly jar = new Map<string, string>();

  constructor(private readonly server: () => unknown) {}

  private cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private store(setCookie: string[] | undefined): void {
    for (const cookie of setCookie ?? []) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async get(path: string): Promise<RpcResult> {
    const res = await request(this.server() as never)
      .get(path)
      .set('Cookie', this.cookieHeader());
    this.store(res.headers['set-cookie'] as unknown as string[] | undefined);
    return {
      status: res.status,
      location: res.headers.location as string | undefined,
      body: res.text,
      json: parseJson(res.text, res.type),
      type: res.type,
      setCookie: res.headers['set-cookie'] as unknown as string[] | undefined,
    };
  }

  async postForm(path: string, fields: Record<string, string>): Promise<RpcResult> {
    const res = await request(this.server() as never)
      .post(path)
      .type('form')
      .set('Cookie', this.cookieHeader())
      .send(fields);
    this.store(res.headers['set-cookie'] as unknown as string[] | undefined);
    return {
      status: res.status,
      location: res.headers.location as string | undefined,
      body: res.text,
      json: parseJson(res.text, res.type),
      type: res.type,
      setCookie: res.headers['set-cookie'] as unknown as string[] | undefined,
    };
  }

  /** Form POST with HTTP Basic client authentication (confidential clients). */
  async postFormBasic(
    path: string,
    fields: Record<string, string>,
    clientId: string,
    clientSecret: string,
  ): Promise<RpcResult> {
    const res = await request(this.server() as never)
      .post(path)
      .type('form')
      .set('Cookie', this.cookieHeader())
      .auth(clientId, clientSecret)
      .send(fields);
    this.store(res.headers['set-cookie'] as unknown as string[] | undefined);
    return {
      status: res.status,
      location: res.headers.location as string | undefined,
      body: res.text,
      json: parseJson(res.text, res.type),
      type: res.type,
      setCookie: res.headers['set-cookie'] as unknown as string[] | undefined,
    };
  }
}
