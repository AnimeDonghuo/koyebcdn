import {DEFAULT_SITE_ORIGIN} from './playback-auth.js';

// Basic browser hotlink deterrence only. These headers are forgeable; this is
// deliberately NOT viewer authentication or protection against download tools.
export function createSitePlaybackAuth(env){
  const site=new URL(env.ALLOWED_SITE_ORIGIN||DEFAULT_SITE_ORIGIN);
  if(site.protocol!=='https:'||site.username||site.password||site.pathname!=='/'||site.search||site.hash)throw new Error('ALLOWED_SITE_ORIGIN must be one exact HTTPS origin');
  const deny=()=>{throw Object.assign(new Error('Open this video in the player on the allowed website.'),{status:403});};
  return {
    allowedSite:site.origin,
    authorize(req,resource){
      if(req.headers['sec-fetch-mode']==='navigate')return deny();
      if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')return deny();
      let referrer;try{referrer=new URL(req.headers.referer);}catch{return deny();}
      // The allowed website embeds the player; subsequent video/API requests
      // therefore refer to the PLAYER origin, not the parent website origin.
      if(!['https:','http:'].includes(referrer.protocol)||referrer.host!==req.headers.host||referrer.username||referrer.password)return deny();
      if(req.headers.origin&&req.headers.origin!==referrer.origin)return deny();
      return {resource};
    },
  };
}
