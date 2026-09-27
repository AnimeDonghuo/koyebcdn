import http from 'node:http';
import {createMTProto} from './mtproto.js';
import {parseTelegramLink,isTelegramPlayerPath} from './telegram-link.js';
import {createStore} from './store.js';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {validateVideo,telegramVideo,publicVideo,MAX_TELEGRAM_BYTES} from './catalog.js';
const root=dirname(fileURLToPath(import.meta.url));
export function createApp(env=process.env, dependencies={}) {
  const mtproto=dependencies.mtproto??createMTProto(env);
  const expose=v=>({...publicVideo(v,mtproto.enabled),watchUrl:`/watch/${v.id}`,embedUrl:`/watch/${v.id}`});
  const store=dependencies.store??createStore(env);
  const get=id=>store.get(id),put=v=>store.put(v);
  const origins=(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const equal=(a,b)=>!!a&&!!b&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const assets=new Map(['index.html','player.js','style.css','embed.js','fonts/roboto-latin-400-normal.woff2','fonts/roboto-latin-700-normal.woff2','fonts/roboto-latin-400-italic.woff2'].map(f=>[f,readFileSync(`${root}/public/${f}`)]));
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
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(origins.includes(req.headers.origin)){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range'});return res.end();}
    try {
      const requestUrl=new URL(req.url,'http://localhost'),path=requestUrl.pathname;
      if(path==='/healthz') return send(res,200,{ok:true,activeStreams:active});
      if(path==='/api/videos'&&req.method==='POST') {
        if(!equal(req.headers.authorization,env.ADMIN_TOKEN?`Bearer ${env.ADMIN_TOKEN}`:null)) return send(res,401,{error:'Unauthorized'});
        let video;try{video=validateVideo(await body(req));}catch(e){return send(res,e.status||400,{error:e.message});}await put(video);return send(res,201,expose(video));
      }
      if(path==='/telegram/webhook'&&req.method==='POST') {
        if(!equal(req.headers['x-telegram-bot-api-secret-token'],env.TELEGRAM_WEBHOOK_SECRET)) return send(res,401,{error:'Unauthorized'});
        const update=await body(req), message=update.channel_post??update.edited_channel_post;
        if(!message || !env.TELEGRAM_CHANNEL_ID || String(message.chat?.id)!==env.TELEGRAM_CHANNEL_ID) return send(res,200,{ok:true,ignored:true});
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
        const source=parseTelegramLink(requestUrl.searchParams.get('url'),env.TELEGRAM_CHANNEL_ID);
        requireMTProto();
        const metadata=await describePost(source);
        return send(res,200,{id:`tg-${source.channelId.slice(1)}-${source.messageId}`,title:metadata.title,
          sources:[{height:metadata.height,type:metadata.type,url:`/telegram/media/${source.channelId.slice(4)}/${source.messageId}`,available:true}],subtitles:[]});
      }
      const api=path.match(/^\/api\/videos\/([\w-]+)$/);
      if(api&&req.method==='GET'){const v=await get(api[1]);return send(res,v?200:404,v?expose(v):{error:'Video not found'});}
      const media=path.match(/^\/media\/([\w-]+)\/(\d+)$/);
      const directMedia=path.match(/^\/telegram\/media\/([1-9]\d*)\/([1-9]\d*)$/);
      if((media||directMedia)&&['GET','HEAD'].includes(req.method)) {
        let source;
        if(directMedia){
          source=parseTelegramLink(`https://t.me/c/${directMedia[1]}/${directMedia[2]}`,env.TELEGRAM_CHANNEL_ID);
          requireMTProto();
        }else source=(await get(media[1]))?.sources.find(s=>s.height===Number(media[2])&&s.fileId);
        if(!source) return send(res,404,{error:'Source not found'});
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
        if(assets.has(name)){res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.woff2')?'font/woff2':'text/css; charset=utf-8');res.setHeader('Cache-Control','public, max-age=300');return res.end(req.method==='HEAD'?undefined:assets.get(name));}
      }
      send(res,404,{error:'Not found'});
    }catch(e){if(!res.headersSent&&!res.destroyed){if(e.status===503)res.setHeader('Retry-After','5');res.removeHeader('Content-Length');if(e.status!==416)res.removeHeader('Content-Range');send(res,e.status||502,{error:e.status?e.message:'Request could not be completed'});}else res.destroy();}
  });
  server.maxConnections=128;
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  server.on('close',()=>{store.close().catch(()=>{});mtproto.close().catch(()=>{});});return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) createApp().listen(Number(process.env.PORT)||8000,'0.0.0.0',()=>console.log('Watch API listening'));
