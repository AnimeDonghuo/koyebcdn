import http from 'node:http';
import {createSitePlaybackAuth} from './site-playback-auth.js';
import {createPlaybackAuth,telegramResource,catalogResource} from './playback-auth.js';
import {createMTProto} from './mtproto.js';
import {parseTelegramLink,isTelegramPlayerPath,configuredTelegramChannels} from './telegram-link.js';
import {createStore} from './store.js';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {validateVideo,telegramVideo,publicVideo,MAX_TELEGRAM_BYTES} from './catalog.js';
const root=dirname(fileURLToPath(import.meta.url));
export function createApp(env=process.env, dependencies={}) {
  const channels=configuredTelegramChannels(env);
  const playbackMode=env.PLAYBACK_AUTH_MODE||'site';
  if(!['site','signed'].includes(playbackMode))throw new Error('PLAYBACK_AUTH_MODE must be site or signed');
  const playback=dependencies.playback??(playbackMode==='signed'?createPlaybackAuth(env):createSitePlaybackAuth(env));
  const mtproto=dependencies.mtproto??createMTProto(env);
  const expose=v=>{
    const result=publicVideo(v,mtproto.enabled);
    result.sources=result.sources.map(source=>{
      const stored=v.sources.find(s=>s.height===source.height);
      return stored?.fileId&&!channels.has(String(stored.channelId))?{...source,available:false,reason:'This source channel is no longer allowed, or its channel reference is missing.'}:source;
    });
    return {...result,watchUrl:`/watch/${v.id}`,embedUrl:`/watch/${v.id}`};
  };
  const store=dependencies.store??createStore(env);
  const get=id=>store.get(id),put=v=>store.put(v);
  const equal=(a,b)=>!!a&&!!b&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const assets=new Map(['index.html','player.js','playback-access.js','subtitle-controller.js','audio-controller.js','media-health.js','subtitle-utils.js','subtitle-worker.js','style.css','embed.js','fonts/roboto-latin-400-normal.woff2','fonts/roboto-latin-700-normal.woff2','fonts/roboto-latin-400-italic.woff2'].map(f=>[f,readFileSync(`${root}/public/${f}`)]));
  // Version the entire small static module graph together. A redeploy must not
  // combine a cached old controller/worker with a newer player entry point.
  const digest=createHash('sha256');for(const [name,content] of assets)digest.update(name).update(content);
  const assetVersion=digest.digest('hex').slice(0,16);
  for(const [name,content] of assets){
    if(!/\.(html|js|css)$/.test(name))continue;
    let text=content.toString();
    for(const target of assets.keys())for(const prefix of ['/','./'])for(const quote of ['"',"'"]){
      const before=quote+prefix+target+quote;
      text=text.split(before).join(quote+prefix+target+'?v='+assetVersion+quote);
    }
    assets.set(name,Buffer.from(text));
  }
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  async function body(req) {let text='';for await(const b of req){text+=b;if(Buffer.byteLength(text)>65536) throw Object.assign(new Error('Body exceeds 64 KB'),{status:413});}try{return JSON.parse(text);}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}}
  let active=0;
  const maxStreams=Math.max(1,Math.min(8,Math.floor(Number(env.MAX_STREAMS))||2));
  const fileCache=new Map();
  const metadataCache=new Map(),lookups=new Map();
  function requireMTProto(){
    if(!mtproto.enabled)throw Object.assign(new Error('Set TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_BOT_TOKEN in Koyeb for direct Telegram links'),{status:503});
  }
  async function describePost(source){
    const key=`${source.channelId}/${source.messageId}`,cached=metadataCache.get(key);
    if(cached&&cached.expires>Date.now())return cached.value;
    if(lookups.has(key))return lookups.get(key);
    if(lookups.size>=2)throw Object.assign(new Error('Video lookup capacity reached; retry shortly'),{status:503});
    const pending=(async()=>{
      const stored=await store.getPost(key);
      let value;
      if(stored && Date.now()-stored.fetchedAt<60000)value=stored.value;
      else {value=await mtproto.describe(source);await store.putPost(key,{value,fetchedAt:Date.now()});}
      if(metadataCache.size>=128)metadataCache.delete(metadataCache.keys().next().value);
      metadataCache.set(key,{value,expires:Date.now()+60000});return value;
    })().finally(()=>lookups.delete(key));
    lookups.set(key,pending);return pending;
  }
  async function tg(method,data) {
    if(!env.TELEGRAM_BOT_TOKEN) throw Object.assign(new Error('Telegram not configured'),{status:503});
    const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
    const j=await r.json();if(!r.ok||!j.ok) throw Object.assign(new Error('Telegram file unavailable'),{status:502});return j.result;
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy',playbackMode==='signed'?'no-referrer':'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',`frame-ancestors ${playback.allowedSite}; base-uri 'none'; object-src 'none'`);
    if(req.method==='OPTIONS'){res.writeHead(204,{'Allow':'GET, HEAD, POST, OPTIONS'});return res.end();}
    try {
      const requestUrl=new URL(req.url,'http://localhost'),path=requestUrl.pathname;
      if(path==='/'&&!requestUrl.search){
        // Public service status only, not a player entry point. This remains
        // embeddable for deployment previews; every actual player is restricted.
        res.setHeader('Content-Security-Policy',"base-uri 'none'; object-src 'none'");
        return send(res,200,{service:'Telegram player',playbackMode,allowedSite:playback.allowedSite,message:'Open videos through the authorized site. Plain links do not grant playback access.'});
      }
      if(path==='/player-config.js'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
        return res.end(`export const allowedSite=${JSON.stringify(playback.allowedSite)};export const playbackMode=${JSON.stringify(playbackMode)};`);
      }
      if(playbackMode==='site'&&['/api/playback/grant','/api/playback/session'].includes(path))return send(res,410,{error:'Site URL mode does not use playback tokens or sessions.'});
      if(path==='/api/playback/grant'&&req.method==='POST')return send(res,200,playback.issue(req,await body(req)));
      if(path==='/api/playback/session'&&req.method==='POST'){
        const input=await body(req);
        if(typeof input.resource!=='string'||input.resource.length>200)return send(res,400,{error:'Invalid playback resource'});
        return send(res,200,playback.open(req,res,input.resource));
      }
      if(path==='/api/playback/session'&&req.method==='GET'){
        const resource=requestUrl.searchParams.get('resource');
        if(!resource||resource.length>200)return send(res,400,{error:'Invalid playback resource'});
        const claims=playback.authorize(req,resource);return send(res,200,{expiresAt:claims.exp*1000});
      }
      if(path==='/healthz') return send(res,200,{ok:true,activeStreams:active});
      if(path==='/api/videos'&&req.method==='POST') {
        if(!equal(req.headers.authorization,env.ADMIN_TOKEN?`Bearer ${env.ADMIN_TOKEN}`:null)) return send(res,401,{error:'Unauthorized'});
        let video;try{video=validateVideo(await body(req));}catch(e){return send(res,e.status||400,{error:e.message});}await put(video);return send(res,201,expose(video));
      }
      if(path==='/telegram/webhook'&&req.method==='POST') {
        if(!equal(req.headers['x-telegram-bot-api-secret-token'],env.TELEGRAM_WEBHOOK_SECRET)) return send(res,401,{error:'Unauthorized'});
        const update=await body(req), message=update.channel_post??update.edited_channel_post;
        if(!message || !channels.has(String(message.chat?.id))) return send(res,200,{ok:true,ignored:true});
        const caption=(message.text??message.caption??'').trim();
        if(caption.startsWith('{')) {
          let video;try {video=validateVideo(JSON.parse(caption));}catch {return send(res,200,{ok:true,ignored:true,reason:'Invalid manifest'});}
          await put(video);
        } else {
          const parsed=telegramVideo(message);
          if(parsed)await store.mergeTelegram(parsed);
        }
        return send(res,200,{ok:true});
      }
      if(path==='/api/telegram'&&req.method==='GET'){
        const source=parseTelegramLink(requestUrl.searchParams.get('url'),channels);
        playback.authorize(req,telegramResource(source));
        requireMTProto();
        const metadata=await describePost(source);
        return send(res,200,{id:`tg-${source.channelId.slice(1)}-${source.messageId}`,title:metadata.title,
          sources:[{height:metadata.height,type:metadata.type,url:`/telegram/media/${source.channelId.slice(4)}/${source.messageId}`,available:true}],subtitles:[]});
      }
      const api=path.match(/^\/api\/videos\/([\w-]+)$/);
      if(api&&req.method==='GET'){playback.authorize(req,catalogResource(api[1]));const v=await get(api[1]);return send(res,v?200:404,v?expose(v):{error:'Video not found'});}
      const media=path.match(/^\/media\/([\w-]+)\/(\d+)$/);
      const directMedia=path.match(/^\/telegram\/media\/([1-9]\d*)\/([1-9]\d*)$/);
      if((media||directMedia)&&['GET','HEAD'].includes(req.method)) {
        let source;
        if(directMedia){
          source=parseTelegramLink(`https://t.me/c/${directMedia[1]}/${directMedia[2]}`,channels);
          playback.authorize(req,telegramResource(source));
          requireMTProto();
        }else {playback.authorize(req,catalogResource(media[1]));source=(await get(media[1]))?.sources.find(s=>s.height===Number(media[2])&&s.fileId);}
        if(!source) return send(res,404,{error:'Source not found'});
        if(!channels.has(String(source.channelId)))return send(res,403,{error:'This source is not in an allowed DB channel. Reimport legacy entries with missing channel references.'});
        const useMTProto=mtproto.enabled && source.channelId && Number.isInteger(source.messageId);
        if(!useMTProto&&(!source.size||source.size>MAX_TELEGRAM_BYTES)) return send(res,422,{error:'Configure MTProto bot authorization and reimport this post, or use a direct media URL.'});
        if(active>=maxStreams){res.setHeader('Retry-After','5');return send(res,503,{error:'Stream capacity reached. Try again shortly.'});}
        if(!useMTProto&&req.headers.range&&!/^bytes=\d*-\d*$/.test(req.headers.range)) return send(res,416,{error:'Only single byte ranges supported'});
        active++;
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),useMTProto?15*60*1000:120000);
        const disconnect=()=>controller.abort();res.on('close',disconnect);
        try {
          if(useMTProto){await mtproto.stream(req,res,source,controller.signal);return;}
          let cached=fileCache.get(source.fileId);
          if(!cached||cached.expires<Date.now()){const file=await tg('getFile',{file_id:source.fileId});cached={path:file.file_path,expires:Date.now()+30*60*1000};if(fileCache.size>=128)fileCache.delete(fileCache.keys().next().value);fileCache.set(source.fileId,cached);}
          const upstream=await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${cached.path}`,{method:req.method,headers:req.headers.range?{Range:req.headers.range}:{},signal:controller.signal});
          if(![200,206,416].includes(upstream.status)){await upstream.body?.cancel();throw new Error('Upstream unavailable');}
          res.statusCode=upstream.status;
          for(const h of ['content-length','content-range','accept-ranges']) if(upstream.headers.has(h))res.setHeader(h,upstream.headers.get(h));
          res.setHeader('Content-Type',source.type);res.setHeader('Cache-Control','private, max-age=0');
          if(req.method==='HEAD'||!upstream.body)res.end();else await pipeline(Readable.fromWeb(upstream.body),res);
        } finally {clearTimeout(timer);res.off('close',disconnect);active--;}
        return;
      }
      if(['GET','HEAD'].includes(req.method)) {
        const name=(path==='/'||path==='/watch'||path.startsWith('/watch/')||isTelegramPlayerPath(path))?'index.html':path.slice(1);
        if(assets.has(name)){res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.woff2')?'font/woff2':'text/css; charset=utf-8');res.setHeader('Cache-Control',name==='index.html'?'no-store':requestUrl.searchParams.get('v')===assetVersion?'public, max-age=300':'no-cache');return res.end(req.method==='HEAD'?undefined:assets.get(name));}
      }
      send(res,404,{error:'Not found'});
    }catch(e){if(!res.headersSent&&!res.destroyed){if(e.status===503)res.setHeader('Retry-After','5');res.removeHeader('Content-Length');if(e.status!==416)res.removeHeader('Content-Range');send(res,e.status||502,{error:e.status?e.message:'Request could not be completed'});}else res.destroy();}
  });
  server.maxConnections=128;
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  server.on('close',()=>{store.close().catch(()=>{});mtproto.close().catch(()=>{});});return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) createApp().listen(Number(process.env.PORT)||8000,'0.0.0.0',()=>console.log('Watch API listening'));
