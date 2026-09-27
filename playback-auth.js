import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {parseTelegramLink,configuredTelegramChannels} from './telegram-link.js';
import {validId} from './catalog.js';

export const DEFAULT_SITE_ORIGIN='https://youngest-corabella-platinum0-23c07cdf.koyeb.app';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function safeEqual(a,b){return typeof a==='string'&&typeof b==='string'&&a.length>0&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function telegramResource(source){return `tg:${source.channelId}:${source.messageId}`;}
export function catalogResource(id){return `video:${id}`;}
export function resourceForTarget(target,channel){
  if(!target||typeof target!=='object'||(!!target.url===!!target.id))return fail(400,'Supply exactly one Telegram url or catalog id');
  if(target.url)return telegramResource(parseTelegramLink(target.url,channel));
  if(!validId(target.id))return fail(400,'Invalid catalog id');
  return catalogResource(target.id);
}
export function createPlaybackAuth(env,clock=()=>Date.now()){
  const channels=configuredTelegramChannels(env);
  const site=new URL(env.ALLOWED_SITE_ORIGIN||DEFAULT_SITE_ORIGIN);
  if(site.protocol!=='https:'||site.username||site.password||site.pathname!=='/'||site.search||site.hash)throw new Error('ALLOWED_SITE_ORIGIN must be one exact HTTPS origin');
  const allowedSite=site.origin,grantTTL=60;
  const sessionTTL=Math.max(120,Math.min(900,Math.floor(Number(env.PLAYBACK_SESSION_TTL_SECONDS))||600));
  const secret=env.PLAYBACK_SIGNING_SECRET,issuerKey=env.PLAYBACK_ISSUER_KEY;
  function ready(){if(typeof secret!=='string'||secret.length<32||typeof issuerKey!=='string'||issuerKey.length<32)return fail(503,'Protected playback is not configured. Set PLAYBACK_SIGNING_SECRET and PLAYBACK_ISSUER_KEY (at least 32 characters each).');if(secret===issuerKey)return fail(503,'Use independent playback signing and issuer secrets.');}
  const now=()=>Math.floor(clock()/1000);
  const signature=payload=>createHmac('sha256',secret).update(payload).digest('base64url');
  function sign(kind,resource,ttl){const iat=now(),exp=iat+ttl,payload=Buffer.from(JSON.stringify({v:1,kind,resource,aud:allowedSite,iat,exp})).toString('base64url');return {token:`${payload}.${signature(payload)}`,expiresAt:exp*1000,resource};}
  function verify(token,kind,resource){
    ready();
    if(typeof token!=='string'||token.length>2048)return fail(401,'Playback permission missing or expired. Open the video on the authorized site.');
    const parts=token.split('.');
    if(parts.length!==2||!safeEqual(signature(parts[0]),parts[1]))return fail(401,'Invalid playback permission');
    let claims;try{claims=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{return fail(401,'Invalid playback permission');}
    if(!claims||claims.v!==1||claims.kind!==kind||claims.aud!==allowedSite||!Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.iat)||claims.exp<=now()||claims.iat>now()+30||typeof claims.resource!=='string')return fail(401,'Playback permission expired or invalid');
    if(resource&&claims.resource!==resource)return fail(403,'This playback permission belongs to another video');
    return claims;
  }
  function browserBoundary(req){
    // Supplementary browser hotlink protection, NOT authentication. Non-browser
    // clients can forge these headers; they must still present a signed credential.
    const site=req.headers['sec-fetch-site'],mode=req.headers['sec-fetch-mode'];
    if((site&&site!=='same-origin')||mode==='navigate')return fail(403,'Playback requests must come from the embedded player');
  }
  const cookieName=resource=>`__Host-watch-${createHash('sha256').update(resource).digest('hex').slice(0,24)}`;
  return {
    allowedSite,
    issue(req,target){
      ready();if(!safeEqual(req.headers.authorization,`Bearer ${issuerKey}`))return fail(401,'Invalid playback issuer key');
      const resource=resourceForTarget(target,channels);
      return sign('grant',resource,grantTTL);
    },
    open(req,res,resource){
      browserBoundary(req);
      const token=req.headers.authorization?.replace(/^Bearer /,'');
      const claims=verify(token,'grant',resource);
      const session=sign('session',claims.resource,sessionTTL);
      // CHIPS partitions this HttpOnly cookie by the top-level site. Nothing is
      // placed in media URLs, and renewal does not reload/rebuffer the video.
      res.setHeader('Set-Cookie',`${cookieName(claims.resource)}=${session.token}; Path=/; Max-Age=${sessionTTL}; Secure; HttpOnly; SameSite=None; Partitioned`);
      return {resource:claims.resource,expiresAt:session.expiresAt,ttlSeconds:sessionTTL};
    },
    authorize(req,resource){
      browserBoundary(req);const key=cookieName(resource);
      const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${key}=`))?.slice(key.length+1);
      return verify(token,'session',resource);
    },
  };
}
