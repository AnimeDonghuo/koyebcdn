// Copy this helper to the AUTHORIZED WEBSITE backend, NOT the player service.
// Node.js 22+. No dependencies. Mount it at POST /api/playback-token.
export function createPlaybackGrantHandler({playerOrigin,issuerKey,siteOrigin,authorize,fetchGrant=fetch}){
  const player=new URL(playerOrigin),site=new URL(siteOrigin);
  if(player.protocol!=='https:'||site.protocol!=='https:'||typeof issuerKey!=='string'||issuerKey.length<32||typeof authorize!=='function')throw new Error('Configure HTTPS origins, a server-only issuer key, and your authorization callback');
  return async(req,res)=>{
    const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    try{
      if(req.method!=='POST')return reply(405,{error:'POST required'});
      // CSRF / browser origin checks supplement your session checks below.
      // Origin alone is NOT authentication; curl can forge it.
      if(req.headers.origin!==site.origin||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return reply(403,{error:'Not allowed from this origin'});
      if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'JSON required'});
      let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>4096)return reply(413,{error:'Request too large'});}
      let input;try{input=JSON.parse(text);}catch{return reply(400,{error:'Invalid JSON'});}
      if(!input||typeof input!=='object'||(!!input.url===!!input.id))return reply(400,{error:'Supply one video id or Telegram url'});
      const target=input.url?{url:input.url}:{id:input.id};
      // REQUIRED: validate your real site session and per-video access here.
      // Add your site's rate limiter before this handler. Do NOT replace this
      // with a Referrer/Origin check and claim it authenticates viewers.
      if(!await authorize(req,target))return reply(403,{error:'Your site session cannot watch this video'});
      const upstream=await fetchGrant(new URL('/api/playback/grant',player.origin),{
        method:'POST',headers:{Authorization:`Bearer ${issuerKey}`,'Content-Type':'application/json'},body:JSON.stringify(target),signal:AbortSignal.timeout(8000),
      });
      if(!upstream.ok)return reply(502,{error:'The player could not authorize playback'});
      const grant=await upstream.json();return reply(200,grant);
    }catch{return reply(502,{error:'Playback authorization unavailable'});}
  };
}
