import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTelegramLink,isTelegramPlayerPath,linkFromPath} from '../telegram-link.js';
import {createApp as createServer} from '../server.js';
import {createMemoryStore} from '../store.js';
const createApp=(env,deps={})=>createServer(env,{store:createMemoryStore(),playback:{allowedSite:'https://site.example',authorize(){}},...deps});
const url='https://t.me/c/2617067511/22047',channel='-1002617067511';
test('parses the supplied post link and validates channel, protocol, host and post number',()=>{
  assert.deepEqual(parseTelegramLink(url,channel),{channelId:channel,messageId:22047});
  assert.throws(()=>parseTelegramLink(url,'-100999'),{status:403});
  assert.throws(()=>parseTelegramLink(url,''),{status:503});
  for(const value of ['https://evil.example/c/2617067511/22047','http://t.me/c/2617067511/22047','https://x@t.me/c/2617067511/22047','https://t.me/c/2617067511/0','https://t.me/c/2617067511/2147483648','https://t.me/c/2617067511/22047?single','https://t.me/public/22047'])assert.throws(()=>parseTelegramLink(value,channel),{status:400});
  for(const path of [`/${url}`,`/watch/${url}`,`/${encodeURIComponent(url)}`]){assert.equal(isTelegramPlayerPath(path),true);assert.equal(linkFromPath(path),url);}
});
test('direct post links resolve without webhook or catalog; media routes are channel-restricted',async t=>{
  let lookups=0,streams=0;
  const mtproto={enabled:true,async describe(source){lookups++;assert.deepEqual(source,{channelId:channel,messageId:22047});return {title:'Episode 480p',height:480,type:'video/mp4'};},async stream(req,res,source){streams++;assert.deepEqual(source,{channelId:channel,messageId:22047});res.setHeader('Content-Type','video/mp4');res.end(req.method==='HEAD'?undefined:'mock-video');},async close(){}};
  const server=createApp({TELEGRAM_CHANNEL_ID:channel},{mtproto});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of [`/${url}`,`/watch/${url}`,`/watch?url=${encodeURIComponent(url)}`]){const res=await fetch(base+path);assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/html/);assert.match(await res.text(),/id="player"/);}
  const path=`/api/telegram?url=${encodeURIComponent(url)}`;
  let res=await fetch(base+path);assert.equal(res.status,200);const data=await res.json();assert.equal(data.sources[0].height,480);assert.equal(data.sources[0].url,'/telegram/media/2617067511/22047');assert.equal(data.sources[0].available,true);
  await fetch(base+path);assert.equal(lookups,1);
  res=await fetch(base+data.sources[0].url);assert.equal(res.status,200);assert.equal(await res.text(),'mock-video');assert.equal(streams,1);
  res=await fetch(base+data.sources[0].url,{method:'HEAD'});assert.equal(res.status,200);assert.equal(await res.text(),'');
  res=await fetch(base+'/telegram/media/999/22047');assert.equal(res.status,403);assert.equal(streams,2);
  res=await fetch(base+'/api/telegram?url='+encodeURIComponent('https://t.me/c/999/22047'));assert.equal(res.status,403);assert.equal(lookups,1);
  res=await fetch(base+'/api/telegram');assert.equal(res.status,400);
});
test('direct links report missing MTProto configuration clearly',async t=>{
  const server=createApp({TELEGRAM_CHANNEL_ID:channel});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const res=await fetch(`http://127.0.0.1:${server.address().port}/api/telegram?url=${encodeURIComponent(url)}`);
  assert.equal(res.status,503);assert.match((await res.json()).error,/TELEGRAM_API_ID/);
});
test('direct Telegram streams obey the configured concurrency ceiling',async t=>{
  let release,started;
  const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r);
  const mtproto={enabled:true,async stream(req,res){started();await gate;res.end('video');},async close(){}};
  const server=createApp({TELEGRAM_CHANNEL_ID:channel,MAX_STREAMS:'1'},{mtproto});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{release();return new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const first=fetch(base+'/telegram/media/2617067511/22047');
  await entered;
  try{
    const second=await fetch(base+'/telegram/media/2617067511/22048');
    assert.equal(second.status,503);assert.equal(second.headers.get('retry-after'),'5');
    assert.equal((await (await fetch(base+'/healthz')).json()).activeStreams,1);
  }finally{release();}
  assert.equal(await (await first).text(),'video');
  assert.equal((await (await fetch(base+'/healthz')).json()).activeStreams,0);
});
