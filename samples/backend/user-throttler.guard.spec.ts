import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { throttleTrackerFor, UserThrottlerGuard } from './user-throttler.guard';

const SECRET = 'test-secret';
const sign = (payload: object, secret = SECRET, opts: object = { expiresIn: '15m' }) =>
  new JwtService().sign(payload, { secret, ...opts });

describe('throttleTrackerFor (per user, not per shared IP)', () => {
  const req = (auth?: string) => ({ ip: '10.0.0.7', headers: auth ? { authorization: auth } : {} });

  it('keys a request with a valid token by user id', () => {
    expect(throttleTrackerFor(req(`Bearer ${sign({ sub: 'user-1' })}`), SECRET)).toBe('u:user-1');
  });

  it('two students on one dorm IP get two buckets', () => {
    const a = throttleTrackerFor(req(`Bearer ${sign({ sub: 'a' })}`), SECRET);
    const b = throttleTrackerFor(req(`Bearer ${sign({ sub: 'b' })}`), SECRET);
    expect(a).not.toBe(b);
  });

  it('falls back to the IP when anonymous, forged, or expired', () => {
    expect(throttleTrackerFor(req(), SECRET)).toBe('ip:10.0.0.7');
    expect(throttleTrackerFor(req(`Bearer ${sign({ sub: 'x' }, 'wrong-secret')}`), SECRET)).toBe('ip:10.0.0.7');
    expect(throttleTrackerFor(req(`Bearer ${sign({ sub: 'x', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, {})}`), SECRET)).toBe('ip:10.0.0.7');
    expect(throttleTrackerFor(req('Bearer not-a-jwt'), SECRET)).toBe('ip:10.0.0.7');
    expect(throttleTrackerFor(req(`Bearer ${sign({ sub: 'x' })}`), undefined)).toBe('ip:10.0.0.7');
  });
});

describe('UserThrottlerGuard', () => {
  function run(routeLimit: number | undefined, url = '/api/sessions/1/end') {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(routeLimit as any);
    const guard = new UserThrottlerGuard([] as any, {} as any, reflector);
    const seen: string[] = [];
    // Intercept the parent's handleRequest to see which tracker it was given.
    const parent = Object.getPrototypeOf(UserThrottlerGuard.prototype);
    const spy = jest.spyOn(parent, 'handleRequest').mockImplementation(async (...args: any[]) => {
      seen.push(await args[0].getTracker({ ip: '1.2.3.4', headers: { authorization: `Bearer ${sign({ sub: 'u9' }, process.env.JWT_SECRET)}` } }, args[0].context));
      return true;
    });
    const ctx: any = { getHandler: () => () => undefined, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => ({ url }), getResponse: () => ({}) }) };
    return (guard as any)
      .handleRequest({ context: ctx, limit: 300, ttl: 60000, throttler: { name: 'default' }, blockDuration: 60000, getTracker: (r: any) => guard['getTracker'](r), generateKey: jest.fn() })
      .then(() => {
        spy.mockRestore();
        return seen[0];
      });
  }

  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });
  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('uses the user id on ordinary routes', async () => {
    expect(await run(undefined)).toBe('u:u9');
  });

  it('keeps auth routes with their own @Throttle keyed by IP', async () => {
    expect(await run(5, '/api/auth/login')).toBe('ip:1.2.3.4');
  });

  it('keys upload routes with their own @Throttle by user', async () => {
    expect(await run(12, '/api/sessions/abc/end')).toBe('u:u9');
  });
});
