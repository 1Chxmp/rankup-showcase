import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerGetTrackerFunction, ThrottlerRequest } from '@nestjs/throttler';

// Rate limit per USER, not per IP (2026-10-14).
//
// The global throttler keyed every request on the client IP. Campus Wi-Fi and
// mobile-carrier NAT put many people behind one address, so a dorm full of
// students sharing an IP shared one bucket and started getting silent 429s
// (the 2026-09-18 proxy-IP bug, at a smaller scale). Now a request carrying a
// valid access token is tracked by its user id; anonymous requests (and any
// invalid / expired token) still fall back to the IP.
//
// Routes with their own @Throttle override (login, register, password reset,
// uploads...) stay IP-keyed on purpose: those limits exist to slow down one
// client hammering an endpoint, often before any account exists.
//
// The token is VERIFIED here (signature + expiry with JWT_SECRET), not just
// decoded: an unverified sub would let anyone pick whose bucket to drain.
// Passport has not run yet at APP_GUARD time, so req.user is not available.

// @nestjs/throttler does not export its metadata keys from the package
// root; this is THROTTLER_LIMIT in dist/throttler.constants.
const THROTTLER_LIMIT_KEY = 'THROTTLER:LIMIT';

const jwt = new JwtService();

/** `u:<userId>` for a request with a valid Bearer token, else `ip:<ip>`. */
export function throttleTrackerFor(req: Record<string, any>, secret: string | undefined = process.env.JWT_SECRET): string {
  const header: unknown = req?.headers?.authorization;
  if (secret && typeof header === 'string' && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify<{ sub?: string }>(header.slice(7).trim(), { secret });
      if (payload?.sub) return `u:${payload.sub}`;
    } catch {
      // invalid or expired: treat as anonymous
    }
  }
  return `ip:${req?.ip ?? 'unknown'}`;
}

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return throttleTrackerFor(req);
  }

  // @nestjs/throttler v6: handleRequest takes one ThrottlerRequest object.
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;
    const routeOverride = this.reflector.getAllAndOverride(THROTTLER_LIMIT_KEY + throttler.name, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Only the auth routes (login, register, reset: no account yet, or an
    // attacker guessing one) stay per IP. Uploads and other per-route limits
    // follow the user, so a campus network ending a squad session together
    // isn't one shared bucket.
    const { req } = this.getRequestResponse(context);
    const authRoute = typeof req?.url === 'string' && req.url.startsWith('/api/auth');
    const getTracker: ThrottlerGetTrackerFunction = routeOverride && authRoute
      ? async (r) => `ip:${r?.ip ?? 'unknown'}`
      : requestProps.getTracker;
    return super.handleRequest({ ...requestProps, getTracker });
  }
}
