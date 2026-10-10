import {DEFAULT_SITE_ORIGIN} from './playback-auth.js';

function exactHttpsOrigin(value,name){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error(`${name} must be one exact HTTPS origin`);
  return url.origin;
}

// Basic browser hotlink deterrence only. These headers are forgeable; this is
// deliberately NOT viewer authentication or protection against download tools.
export function createSitePlaybackAuth(env){
  const site=exactHttpsOrigin(env.ALLOWED_SITE_ORIGIN||DEFAULT_SITE_ORIGIN,'ALLOWED_SITE_ORIGIN');
  const player=env.PLAYER_ORIGIN?exactHttpsOrigin(env.PLAYER_ORIGIN,'PLAYER_ORIGIN'):null;
  const deny=()=>{throw Object.assign(new Error('Open this video in the player on the allowed website.'),{status:403});};
  return {
    allowedSite:site,
    authorize(req,resource){
      if(req.headers['sec-fetch-mode']==='navigate')return deny();
      if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')return deny();
      let referrer;try{referrer=new URL(req.headers.referer);}catch{return deny();}
      // The allowed website embeds the player; subsequent video/API requests
      // therefore refer to the PLAYER origin, not the parent website origin.
      // Behind a hosting proxy (e.g. Botkeep) the Host header can be an internal
      // address: prefer X-Forwarded-Host, or an explicit public PLAYER_ORIGIN.
      const forwarded=String(req.headers['x-forwarded-host']||'').split(',')[0].trim();
      const playerHost=player?new URL(player).host:(forwarded||req.headers.host);
      if(!['https:','http:'].includes(referrer.protocol)||!playerHost||referrer.host!==playerHost||referrer.username||referrer.password)return deny();
      if(req.headers.origin&&req.headers.origin!==referrer.origin)return deny();
      return {resource};
    },
  };
}
