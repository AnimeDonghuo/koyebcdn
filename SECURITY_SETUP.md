# Default: basic site-URL checks (no token integration)

Use `PLAYBACK_AUTH_MODE=site` (the default when unset) and:

```env
ALLOWED_SITE_ORIGIN=https://youngest-corabella-platinum0-23c07cdf.koyeb.app
```

Existing plain iframes work. No `PLAYBACK_ISSUER_KEY`, `PLAYBACK_SIGNING_SECRET`, `/api/playback-token`, handshake, or session cookie is required. Old keys may remain; they are ignored in this mode. Redeploy the player after updating, then reload the watch page. Preserve the origin in iframe referrers (the browser default `strict-origin-when-cross-origin` is fine).

CSP allows framing only by the exact configured origin. On Play, the player checks ancestor origins (or `document.referrer` when unavailable). Metadata and media check that requests refer to the player itself and reject browser cross-site requests/navigation. They do not contact the website backend. No video/Telegram/Mongo lookup occurs before Play.

**Limit:** this is deliberately only basic hotlink deterrence. Headers can be forged by scripts/downloaders; these checks do not authenticate viewers or prevent downloading/recording. Telegram channel restrictions, bounded streaming, bot credentials, admin API authentication and webhook secrets are unchanged.

## Optional legacy signed mode

The instructions below apply **only** if you explicitly set `PLAYBACK_AUTH_MODE=signed`. Do not install this integration to fix site-mode playback. Signed mode is more restrictive and requires coordinated website/backend setup before deployment.

---

# Restrict playback to your website

Allowed website:

```text
https://youngest-corabella-platinum0-23c07cdf.koyeb.app
```

**Deployment change:** old plain iframe/media links no longer grant playback. The website backend integration below is required. This repository does not contain your separate website's server, so it cannot install that route automatically.

## How the player knows the request is approved

It does **not** trust a URL, CORS, Origin or Referrer as authentication. Those browser headers can be forged by non-browser clients.

1. The player response has `Content-Security-Policy: frame-ancestors <your exact site origin>`. Browsers refuse to embed it on other sites (including other Koyeb subdomains).
2. Pressing Play asks the parent website for permission using `postMessage`. Both sides verify the exact origin, window source and request ID. Only the video attached to that embed (or its explicit Next video) can be requested.
3. Your site's `/api/playback-token` backend checks your **actual site session and video access rules**. It calls the player service using a secret issuer key that never reaches frontend JavaScript.
4. The player service issues a **60-second, video-specific HMAC-signed grant**. The browser exchanges that grant for a **10-minute, video-specific HttpOnly session cookie**. The cookie is Secure, SameSite=None, Path=/, uses the `__Host-` prefix and requests CHIPS partitioning via `Partitioned`.
5. Every metadata request and Telegram media GET/HEAD/range request verifies that signed session. Copying the visible media URL carries no token and is insufficient to watch.
6. While playing, the parent backend renews permission about one minute before expiry. Only the cookie changes; the video URL is not reloaded. Paused players stop renewing; resuming requests fresh permission if needed.

Token signing and verification are cheap and stateless. They do not scan Telegram, transcode video, or add session writes to MongoDB. Telegram/MongoDB/video loading still starts only after Play.

## 1. Configure the player Koyeb service

In addition to the existing Telegram/MongoDB settings:

```dotenv
ALLOWED_SITE_ORIGIN=https://youngest-corabella-platinum0-23c07cdf.koyeb.app
PLAYBACK_SIGNING_SECRET=FIRST_LONG_RANDOM_VALUE
PLAYBACK_ISSUER_KEY=SECOND_DIFFERENT_LONG_RANDOM_VALUE
PLAYBACK_SESSION_TTL_SECONDS=600
```

Generate two independent values privately, for example by running `openssl rand -hex 32` twice. Both must have at least 32 characters. **Do not commit or paste them in chat, HTML, iframe URLs or frontend environment bundles.** Changing the signing secret invalidates all existing grants/sessions. Allowed session lifetime is 120–900 seconds.

- `PLAYBACK_SIGNING_SECRET`: player service only.
- `PLAYBACK_ISSUER_KEY`: player service **and your website backend**, never the browser.
- Missing/invalid secrets deny playback; there is no insecure fallback switch.
- HTTPS is required in production, including the player service, because session cookies are Secure.

### Multiple Telegram DB channels

Configure `TELEGRAM_CHANNEL_IDS=-1002617067511,-1001234567890` on the player service, using your real IDs. A non-empty list overrides `TELEGRAM_CHANNEL_ID`. One bot must have access to every listed channel. Grants remain bound to the full channel ID **and** post number; adding channels does not make grants reusable across them. Unknown/removed channels are rejected on new metadata/media requests, including persisted catalog sources. The website must still authorize the requested published video from its own records, rather than granting every arbitrary post in an allowed channel.

## 2. Install the website backend route

Copy `examples/site-playback-backend.js` into the website backend. Its server-side variables are listed in `examples/site.env.example`. It is a dependency-free Node.js helper. Mount the returned request handler at **POST `/api/playback-token`** on the authorized website.

Example wiring (adapt `getSiteSession` and `canWatchVideo` to your actual website):

```js
import { createPlaybackGrantHandler } from './site-playback-backend.js';

const playbackTokenHandler = createPlaybackGrantHandler({
  playerOrigin: process.env.WATCH_PLAYER_ORIGIN, // https://YOUR-PLAYER.koyeb.app
  siteOrigin: 'https://youngest-corabella-platinum0-23c07cdf.koyeb.app',
  issuerKey: process.env.PLAYBACK_ISSUER_KEY,
  authorize: async (req, target) => {
    const session = await getSiteSession(req); // your existing authenticated/guest session
    return Boolean(session) && await canWatchVideo(session, target);
  },
});

// In your existing Node HTTP router, before consuming the JSON request body:
// if (req.method === 'POST' && pathname === '/api/playback-token') {
//   return playbackTokenHandler(req, res);
// }
```

The two functions above are intentionally application-specific, **not implemented placeholders that silently permit everyone**. If your site uses PHP, WordPress or another backend, implement the equivalent server-to-server call after its session/permission checks. The helper reads the raw request stream; mount it before a JSON body parser or adapt it to your framework.

The helper additionally checks Origin/Fetch Metadata against the exact website and requires JSON. These are CSRF defenses, **not replacements for session validation**. Add your site's per-session/IP rate limiter before this endpoint. Do not trust client-supplied `X-Forwarded-For` unless your proxy configuration makes it trustworthy.

Your site can allow guests with a genuine server-managed guest session. That still means anyone who visits your public site can get a playback grant. Replacing `authorize` with `() => true` weakens the protection and allows an automated client to forge headers and obtain grants; it must not be described as proof that a viewer is on your site.

The backend request is:

```text
POST https://YOUR-PLAYER.koyeb.app/api/playback/grant
Authorization: Bearer <server-only PLAYBACK_ISSUER_KEY>
Content-Type: application/json

{"url":"https://t.me/c/2617067511/22047"}
```

For a catalog item, send `{"id":"episode-01"}` instead (not both). The grant is bound to one target and the configured site origin. The backend passes the returned `{token, resource, expiresAt}` object to the browser. The issuer key itself is never returned.

## 3. Update the website embed

```html
<script defer
  src="https://YOUR-PLAYER.koyeb.app/embed.js"
  data-token-endpoint="/api/playback-token"></script>

<div data-telegram-url="https://t.me/c/2617067511/22047"></div>
```

Catalog placeholders still work as `data-watch-id="episode-01"`. Title, avatar, poster, label and Next attributes remain supported. The script creates the iframe and handles grant messages. A bare iframe without this parent bridge will show an authorization timeout when Play is pressed. Do not put long-lived credentials in its `src`.

## Browser compatibility

- The implementation requests a partitioned cookie, which modern supporting browsers isolate by the top-level **site**. Exact **origin** restrictions are separately enforced by CSP and the message handshake.
- Browsers/privacy settings that block the session cookie show an error instead of switching to a public stream URL. Some older browsers ignore `Partitioned`; supplementary Fetch Metadata checks and exact-origin iframe restrictions still apply, but do not provide cookie partitioning themselves.
- Verify actual desktop/mobile browsers. The browser regression suite uses virtual HTTPS interception; it verifies signatures, renewals, HttpOnly/Secure cookies and CSP but **does not fully emulate real CHIPS partitioning**.
- If third-party cookies are blocked, deploy the player behind an HTTPS **same-site custom domain/reverse proxy** you control. Keep its player URL and all `/api`, `/telegram/media`, `/media`, script, worker and font paths on that same origin. Do not remove authentication as a workaround.
- Your website CSP must allow the player origin in `frame-src` and `script-src`, and its own token endpoint in `connect-src`.

## What this does not guarantee

- It is not DRM. Authorized viewers can record the screen or use developer tools to obtain media.
- Stolen grants can be replayed for 60 seconds; stolen signed cookies can be replayed until their session expires by non-browser clients forging headers. They are bearer credentials, not hardware-bound proof. No per-viewer revocation/logout store is implemented; rotate the signing secret for global revocation.
- Expiry is checked when a request starts. Existing media responses may finish until the normal streaming deadline; revocation does not retract buffered/downloaded bytes.
- An attacker can visit a public site and automate guest sessions. Use login/access rules, rate limits or an edge anti-abuse service if that is a concern.
- **External direct MP4/subtitle URLs are controlled by their storage provider.** Protect them with provider-signed URLs/access controls too; Koyeb cannot make a public third-party URL private. The protections here guard the player metadata and Koyeb-served Telegram routes.
- MongoDB and stream-capacity limits are unchanged. Session validation is not a substitute for bandwidth protection.

## Verification

`npm test` covers wrong/missing keys, forged referrers, tampering, expired grants/sessions, wrong video/site, GET/HEAD media denial, cookie flags, and the site helper's required authorization callback. `npm run test:browser` covers the parent grant exchange, active renewal without source reload, copied-link denial, wrong-site frame blocking, and existing player features. Real website-session wiring and deployed browser compatibility must be tested on your actual services before rollout.
