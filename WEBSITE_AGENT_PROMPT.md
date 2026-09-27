# Copy this prompt into the agent session for your WEBSITE

Work in the repository for my website, whose production origin is:
https://youngest-corabella-platinum0-23c07cdf.koyeb.app

You previously helped build/deploy this site. I do not know its framework. Inspect the actual repository, package files, server routes, authentication/session code, video records and Koyeb deployment configuration yourself. Implement and test the integration below; do not just explain it or ask me which framework I use. Preserve my current pages, styling, server selector and public/private access rules.

## Goal

Connect this website to my separate protected Telegram player service. The player project is AnimeDonghuo/koyebcdn. Its latest security/multiple-channel changes might not yet be pushed or deployed: do not assume an older main branch contains them. If available, read its SECURITY_SETUP.md, examples/site-playback-backend.js and examples/site.env.example. The self-contained contract below is sufficient to implement the website side. Clearly distinguish local/mock tests from a live, verified deployment.

First find the actual PLAYER service origin in this site's existing player links, configuration or deployment settings. The website origin above is NOT automatically the player origin. If you cannot discover it, ask me only for the public player-service URL—not secrets or my framework.

## Backend requirements

1. Add POST /api/playback-token on THIS website's backend, adapting to its real framework. If it is static-only, add the smallest suitable server/serverless route and update its Koyeb build/start setup; never place the issuer key in browser JavaScript. Keep servers compatible with Koyeb's PORT and 0.0.0.0 binding.
2. Accept JSON containing exactly one target: {"url":"https://t.me/c/2617067511/22047"} or {"id":"episode-01"}. Validate types/lengths, normalize known existing player-link formats, and resolve the target against this website's published episode/video records and access policy. Do not authorize arbitrary user-supplied video targets or fetch arbitrary URLs.
3. Use existing authenticated or server-managed guest sessions. Preserve guest viewing if the site is currently public. If no session mechanism exists, implement a secure server-managed or signed, expiring guest session with HttpOnly/Secure/SameSite cookies and appropriate CSRF defenses. Do not introduce a mandatory login unless the site's existing access rules require it. Document that public guest access cannot stop someone visiting the site and automating a guest session.
4. Check the viewer/session's permission for the actual video. Exact Origin/Fetch Metadata checks are additional CSRF defenses, NOT authentication. Never use authorize: () => true or Referrer alone as supposed proof. Add bounded per-session/IP rate limiting and do not blindly trust caller-supplied forwarding headers.
5. After approval, make this server-to-server request:

   POST {WATCH_PLAYER_ORIGIN}/api/playback/grant
   Authorization: Bearer {PLAYBACK_ISSUER_KEY}
   Content-Type: application/json
   Body: the approved {"url":"..."} or {"id":"..."}

   Return the resulting {"token":"...","resource":"...","expiresAt":123...} object to the browser with Cache-Control: no-store. The grant is video-specific and lasts 60 seconds. Use a short upstream timeout and sanitized errors. Never return or log the issuer key, cookies, grants or Authorization headers.

## Frontend requirements

Include the player service's embed script ONCE, with the site's own token endpoint:

<script defer src="https://ACTUAL-PLAYER-ORIGIN/embed.js" data-token-endpoint="/api/playback-token"></script>
<div data-telegram-url="https://t.me/c/2617067511/22047"></div>

For catalog videos use data-watch-id="episode-01". Render the actual selected episode/source from my website's data, not this hard-coded example. Optional data-title, data-label, data-avatar, data-poster and data-next are supported. Keep the existing provider/server selector working and ensure SPA navigation/dynamic content mounts and cleans up embeds correctly.

Replace bare protected-player iframes with this integration; a plain iframe cannot obtain permission on its own. The player script creates the iframe and handles a strict-origin postMessage handshake, obtains the grant only after Play, exchanges it for a short-lived HttpOnly session, and renews while playing without reloading the video. Do not reimplement or weaken its HMAC verification, exact-origin checks, cookie checks or media-route protection. No autoplay, video prefetching or grant requests before Play. Keep fullscreen/PiP permissions and the responsive player-only layout.

Allow the actual player origin in this website's CSP frame-src and script-src, and its own token endpoint in connect-src. Do not widen policies to arbitrary origins. The player permits this exact production website origin; different preview origins must not be silently added to the production allowlist.

## Multiple Telegram DB channels

The PLAYER service now supports this comma-separated setting:
TELEGRAM_CHANNEL_IDS=-1002617067511,-1001234567890

Use my real channel IDs, not the second example blindly. One Telegram bot must be added as an administrator to every allowed channel. The plural list replaces the legacy TELEGRAM_CHANNEL_ID whenever it is non-empty. Validate/support links from all configured channels instead of hard-coding only the first DB. Keep channel IDs as strings and distinguish full channel ID + post number; matching post numbers in different channels are different videos. Still require the requested target to match an allowed published video in THIS site's records. Adding a DB must not bypass playback authorization or multiply streaming concurrency limits.

This means multiple Telegram storage channels, not multiple MongoDB clusters. The player retains one MongoDB catalog. Existing explicit watch: catalog IDs are global, so only reuse one when intentionally grouping the same episode's resolutions across channels.

## Secrets and deployment

Website backend environment:
- WATCH_PLAYER_ORIGIN = the real player HTTPS origin
- PLAYBACK_ISSUER_KEY = the same issuer key configured on the player service
- Any genuinely required guest/session secret, if this site lacks one

Player service environment (coordinate without exposing values):
- ALLOWED_SITE_ORIGIN=https://youngest-corabella-platinum0-23c07cdf.koyeb.app
- PLAYBACK_SIGNING_SECRET = independent random server-only secret
- PLAYBACK_ISSUER_KEY = matching website-backend issuer key
- PLAYBACK_SESSION_TTL_SECONDS=600
- TELEGRAM_CHANNEL_IDS = the allowed DB channel list
- Existing Telegram/MongoDB settings remain required

The signing secret stays ONLY on the player service. The issuer key stays ONLY on the two backends. Do not put secrets in NEXT_PUBLIC_*, VITE_*, REACT_APP_*, HTML, iframe URLs, Git or chat. Use existing secret-management access if available; otherwise tell me the exact setting names and where to enter them privately. Do not ask me to paste credentials into the conversation.

Test the backend with mocked player responses, then real services only if the configuration/access is available. Test valid viewers, invalid/expired sessions, unauthorized targets, both DB channels, wrong Origin/CSRF, rate limiting, upstream failures, SPA navigation, and zero video/API authorization activity before Play. Browser-test grant exchange, ongoing renewal, subtitle/fullscreen controls, and rejection of a copied link or wrong-site embed. Verify real browser cookie compatibility: the player uses Secure/HttpOnly/SameSite=None/Partitioned cookies; do not bypass security if a browser blocks them. If necessary, propose a same-site HTTPS custom domain/reverse proxy instead.

Implement changes in the current website branch, respecting the project's workflow. Report what was changed, tests run, exact environment/deployment steps, and anything that could not be verified. Do not claim deployed or fully secure if deployment/site-session wiring is incomplete. Coordinate rollout: the new player protection and website integration must both be deployed and configured; deploying only one side will break playback.
