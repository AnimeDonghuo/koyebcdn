import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredTelegramChannels,parseChannelIds,parseTelegramLink} from '../telegram-link.js';
import {createPlaybackAuth} from '../playback-auth.js';
import {createApp} from '../server.js';
import {createMemoryStore} from '../store.js';
const a='-1002617067511',b='-1001234567890';
const url=id=>`https://t.me/c/${id.slice(4)}/7`;
const env={PLAYBACK_AUTH_MODE:'signed',TELEGRAM_CHANNEL_IDS:`${a}, ${b}`,TELEGRAM_CHANNEL_ID:'-100999',TELEGRAM_WEBHOOK_SECRET:'webhook',PLAYBACK_SIGNING_SECRET:'s'.repeat(48),PLAYBACK_ISSUER_KEY:'k'.repeat(48)};

test('multiple DB channel config trims/deduplicates IDs, supports legacy, and rejects wildcards',()=>{
  assert.deepEqual([...parseChannelIds(` ${a}, ${b}\n${a}, `)],[a,b]);
  assert.deepEqual([...configuredTelegramChannels(env)],[a,b]);
  assert.deepEqual([...configuredTelegramChannels({TELEGRAM_CHANNEL_ID:a})],[a]);
  assert.deepEqual([...configuredTelegramChannels({TELEGRAM_CHANNEL_IDS:' ',TELEGRAM_CHANNEL_ID:a})],[a]);
  assert.equal(configuredTelegramChannels({}).size,0);
  for(const value of ['*','2617067511','https://t.me/c/2617067511','-123','-1000',`${a},oops`])assert.throws(()=>parseChannelIds(value),/Invalid Telegram DB/);
  for(const id of [a,b])assert.equal(parseTelegramLink(url(id),configuredTelegramChannels(env)).channelId,id);
  assert.throws(()=>parseTelegramLink(url('-100999'),configuredTelegramChannels(env)),{status:403});
});

test('signed sessions stay bound to their channel, even with the same post number',()=>{
  const auth=createPlaybackAuth(env),req={headers:{authorization:`Bearer ${env.PLAYBACK_ISSUER_KEY}`}};
  const ga=auth.issue(req,{url:url(a)}),gb=auth.issue(req,{url:url(b)});
  assert.notEqual(ga.resource,gb.resource);
  assert.throws(()=>auth.open({headers:{authorization:`Bearer ${ga.token}`}},{setHeader(){}},gb.resource),{status:403});
  assert.throws(()=>auth.issue(req,{url:url('-100999')}),{status:403});
  const restricted=createPlaybackAuth({...env,TELEGRAM_CHANNEL_IDS:a});
  assert.throws(()=>restricted.issue(req,{url:url(b)}),{status:403});
});

test('webhooks, metadata cache and streams support both channels without message-ID collisions',async t=>{
  const store=createMemoryStore(),lookups=[],streams=[];
  const mtproto={enabled:true,async describe(source){lookups.push(source.channelId);return {title:`Video ${source.channelId}`,height:480,type:'video/mp4'};},async stream(req,res,source){streams.push(source.channelId);res.end(req.method==='HEAD'?undefined:'video');},async close(){}};
  const server=createApp(env,{store,mtproto});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  for(const channel of [a,b]){
    const update={channel_post:{chat:{id:channel},message_id:7,video:{file_id:`file-${channel}`,file_size:30000000,height:480}}};
    assert.equal((await post('/telegram/webhook',update,{'X-Telegram-Bot-Api-Secret-Token':'webhook'})).status,200);
    assert.ok(await store.get(`tg-${channel.slice(1)}-7`));
    const grant=await (await post('/api/playback/grant',{url:url(channel)},{Authorization:`Bearer ${env.PLAYBACK_ISSUER_KEY}`})).json();
    const opened=await post('/api/playback/session',{resource:grant.resource},{Authorization:`Bearer ${grant.token}`});
    const headers={Cookie:opened.headers.get('set-cookie').split(';')[0]};
    const metadata=await fetch(base+'/api/telegram?url='+encodeURIComponent(url(channel)),{headers});assert.equal(metadata.status,200);assert.equal((await metadata.json()).title,`Video ${channel}`);
    await fetch(base+'/api/telegram?url='+encodeURIComponent(url(channel)),{headers});
    const media=await fetch(base+`/telegram/media/${channel.slice(4)}/7`,{headers});assert.equal(media.status,200);assert.equal(await media.text(),'video');
  }
  assert.deepEqual(lookups,[a,b]);assert.deepEqual(streams,[a,b]);
  const ignored=await post('/telegram/webhook',{channel_post:{chat:{id:'-100999'},message_id:7,video:{file_id:'blocked',height:480}}},{'X-Telegram-Bot-Api-Secret-Token':'webhook'});
  assert.equal((await ignored.json()).ignored,true);assert.equal(await store.get('tg-100999-7'),null);
});

test('removing a DB channel also blocks its persisted catalog source',async t=>{
  const store=createMemoryStore();await store.put({id:'old-video',title:'Old',sources:[{height:480,fileId:'old',channelId:b,messageId:7,size:100,type:'video/mp4'}],subtitles:[]});
  const auth=createPlaybackAuth({...env,TELEGRAM_CHANNEL_IDS:a});
  let streamed=false;
  const server=createApp({...env,TELEGRAM_CHANNEL_IDS:a},{store,mtproto:{enabled:true,async stream(){streamed=true;},async close(){}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const grant=auth.issue({headers:{authorization:`Bearer ${env.PLAYBACK_ISSUER_KEY}`}},{id:'old-video'});let cookie;
  auth.open({headers:{authorization:`Bearer ${grant.token}`}},{setHeader(k,v){cookie=v.split(';')[0];}},grant.resource);
  const base=`http://127.0.0.1:${server.address().port}`,headers={Cookie:cookie};
  const metadata=await (await fetch(base+'/api/videos/old-video',{headers})).json();assert.equal(metadata.sources[0].available,false);
  assert.equal((await fetch(base+'/media/old-video/480',{headers})).status,403);
  assert.equal(streamed,false);
});
