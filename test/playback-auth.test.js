import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackAuth,DEFAULT_SITE_ORIGIN,resourceForTarget} from '../playback-auth.js';
import {createApp} from '../server.js';
import {createMemoryStore} from '../store.js';
const env={PLAYBACK_AUTH_MODE:'signed',PLAYBACK_SIGNING_SECRET:'s'.repeat(48),PLAYBACK_ISSUER_KEY:'k'.repeat(48),TELEGRAM_CHANNEL_ID:'-1002617067511'};
const target={url:'https://t.me/c/2617067511/22047'};
function session(auth,grant,resource=grant.resource){
  let cookie;const result=auth.open({headers:{authorization:`Bearer ${grant.token}`,'sec-fetch-site':'same-origin'}},{setHeader(k,v){if(k==='Set-Cookie')cookie=v;}},resource);
  return {result,cookie,cookieHeader:cookie.split(';')[0]};
}
test('grants require a backend key; sessions are resource-bound, partitioned, signed and expiring',()=>{
  let now=1700000000000;const auth=createPlaybackAuth(env,()=>now);
  assert.equal(auth.allowedSite,DEFAULT_SITE_ORIGIN);
  assert.throws(()=>auth.issue({headers:{origin:DEFAULT_SITE_ORIGIN,referer:DEFAULT_SITE_ORIGIN}},target),{status:401});
  const grant=auth.issue({headers:{authorization:`Bearer ${env.PLAYBACK_ISSUER_KEY}`}},target);
  assert.equal(grant.resource,'tg:-1002617067511:22047');assert.equal(grant.expiresAt,now+60000);
  assert.throws(()=>session(auth,grant,'video:other'),{status:403});
  assert.throws(()=>session(auth,{...grant,token:grant.token+'x'}),{status:401});
  const opened=session(auth,grant);assert.match(opened.cookie,/Secure; HttpOnly; SameSite=None; Partitioned/);assert.match(opened.cookie,/^__Host-watch-/);
  const request={headers:{cookie:opened.cookieHeader,'sec-fetch-site':'same-origin'}};
  assert.equal(auth.authorize(request,grant.resource).resource,grant.resource);
  assert.throws(()=>auth.authorize(request,'video:other'),{status:401});
  assert.throws(()=>auth.authorize({headers:{...request.headers,'sec-fetch-site':'cross-site'}},grant.resource),{status:403});
  assert.throws(()=>auth.authorize({headers:{...request.headers,'sec-fetch-mode':'navigate'}},grant.resource),{status:403});
  now+=61000;assert.throws(()=>session(auth,grant),{status:401});
  assert.equal(auth.authorize(request,grant.resource).resource,grant.resource);
  const otherSite=createPlaybackAuth({...env,ALLOWED_SITE_ORIGIN:'https://different.example'},()=>now);
  assert.throws(()=>otherSite.authorize(request,grant.resource),{status:401});
  now+=600000;assert.throws(()=>auth.authorize(request,grant.resource),{status:401});
});
test('missing secrets fail closed; unsupported origins and ambiguous targets are rejected',()=>{
  assert.throws(()=>createPlaybackAuth({}).authorize({headers:{}},'video:test'),{status:503});
  assert.throws(()=>createPlaybackAuth({...env,ALLOWED_SITE_ORIGIN:'https://example.com/path'}),/exact HTTPS origin/);
  assert.throws(()=>resourceForTarget({id:'one',url:target.url},env.TELEGRAM_CHANNEL_ID),{status:400});
  assert.throws(()=>resourceForTarget({url:'https://t.me/c/999/1'},env.TELEGRAM_CHANNEL_ID),{status:403});
});
test('all public metadata and media paths require a session, including HEAD and forged referrers',async t=>{
  let streamed=0,lookups=0;
  const store=createMemoryStore();await store.put({id:'episode',title:'Episode',sources:[{height:480,fileId:'private',channelId:env.TELEGRAM_CHANNEL_ID,messageId:22047,size:123,type:'video/mp4'}],subtitles:[]});
  const mtproto={enabled:true,async describe(){lookups++;return {title:'Episode',height:480,type:'video/mp4'};},async stream(req,res){streamed++;res.end(req.method==='HEAD'?undefined:'video');},async close(){}};
  const server=createApp(env,{store,mtproto});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`,paths=['/api/videos/episode',`/api/telegram?url=${encodeURIComponent(target.url)}`,'/media/episode/480','/telegram/media/2617067511/22047'];
  for(const path of paths){for(const method of path.includes('media')?['GET','HEAD']:['GET']){
    const res=await fetch(base+path,{method,headers:{Referer:DEFAULT_SITE_ORIGIN,Origin:DEFAULT_SITE_ORIGIN,'Sec-Fetch-Site':'same-origin'}});assert.equal(res.status,401,path);
  }}assert.equal(streamed,0);assert.equal(lookups,0);
  const html=await fetch(base+'/watch/episode');assert.equal(html.headers.get('content-security-policy'),`frame-ancestors ${DEFAULT_SITE_ORIGIN}; base-uri 'none'; object-src 'none'`);
  const issue=async body=>{const res=await fetch(base+'/api/playback/grant',{method:'POST',headers:{Authorization:`Bearer ${env.PLAYBACK_ISSUER_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(res.status,200);return res.json();};
  const grant=await issue(target);
  const opened=await fetch(base+'/api/playback/session',{method:'POST',headers:{Authorization:`Bearer ${grant.token}`,'Content-Type':'application/json','Sec-Fetch-Site':'same-origin'},body:JSON.stringify({resource:grant.resource})});
  assert.equal(opened.status,200);const cookie=opened.headers.get('set-cookie').split(';')[0];
  let res=await fetch(base+paths[1],{headers:{Cookie:cookie}});assert.equal(res.status,200);
  res=await fetch(base+paths[3],{headers:{Cookie:cookie}});assert.equal(res.status,200);assert.equal(await res.text(),'video');
  res=await fetch(base+paths[2],{headers:{Cookie:cookie}});assert.equal(res.status,401,'Telegram grant must not authorize a catalog alias');
  res=await fetch(base+'/telegram/media/2617067511/22048',{headers:{Cookie:cookie}});assert.equal(res.status,401);
  assert.equal(streamed,1);assert.equal(lookups,1);
});
