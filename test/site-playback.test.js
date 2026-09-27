import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSitePlaybackAuth} from '../site-playback-auth.js';
import {createApp} from '../server.js';
import {createMemoryStore} from '../store.js';
import {DEFAULT_SITE_ORIGIN} from '../playback-auth.js';

const client=readFileSync(new URL('../public/playback-access.js',import.meta.url),'utf8').replace(/^import .*;\n/,'').replace('export function','function');
function access({referrer=DEFAULT_SITE_ORIGIN,ancestors,top=false}={}){
  const window={location:{ancestorOrigins:ancestors}};window.parent=top?window:{};
  return vm.runInNewContext(client+';createPlaybackAccess({},()=>{})',{window,document:{referrer},URL,allowedSite:DEFAULT_SITE_ORIGIN,playbackMode:'site'});
}
test('site mode accepts exact parent URL without messages, fetch, cookies or keys',async()=>{
  await access().ensure();await access({referrer:'',ancestors:[DEFAULT_SITE_ORIGIN]}).ensure();
  access().setActive(true);
  for(const options of [{top:true},{referrer:''},{referrer:'https://evil.example'},{referrer:DEFAULT_SITE_ORIGIN+'.evil.example'},{referrer:'https://evil.example/?site='+DEFAULT_SITE_ORIGIN},{ancestors:[DEFAULT_SITE_ORIGIN,'https://evil.example']}])await assert.rejects(access(options).ensure());
});
test('default site mode serves metadata and media without tokens; basic hotlink checks remain',async t=>{
  let streamed=0,lookups=0;
  const store=createMemoryStore();await store.put({id:'episode',title:'Episode',sources:[{height:480,fileId:'private',channelId:'-1002617067511',messageId:7,size:123,type:'video/mp4'}],subtitles:[]});
  const server=createApp({TELEGRAM_CHANNEL_ID:'-1002617067511',PLAYBACK_ISSUER_KEY:'old-key',PLAYBACK_SIGNING_SECRET:'old-key'},{store,mtproto:{enabled:true,async describe(){lookups++;return {title:'Episode',height:480,type:'video/mp4'};},async stream(req,res){streamed++;res.end(req.method==='HEAD'?undefined:'video');},async close(){}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  assert.throws(()=>createSitePlaybackAuth({}).authorize({headers:{'sec-fetch-mode':'navigate'}}),{status:403});
  const base=`http://127.0.0.1:${server.address().port}`;
  const html=await fetch(base+'/watch/episode');assert.equal(html.status,200);
  assert.match(html.headers.get('content-security-policy'),new RegExp('frame-ancestors '+DEFAULT_SITE_ORIGIN.replaceAll('.','\\.')));
  assert.equal(html.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.match(await (await fetch(base+'/player-config.js')).text(),/playbackMode="site"/);
  assert.equal(lookups,0);assert.equal(streamed,0);
  const paths=['/api/videos/episode','/api/telegram?url=https://t.me/c/2617067511/7','/media/episode/480','/telegram/media/2617067511/7'];
  for(const path of paths)for(const method of path.includes('/media/')?['GET','HEAD']:['GET']){
    for(const headers of [{},{Referer:'https://evil.example/watch'},{Referer:base+'/watch/episode','Sec-Fetch-Site':'cross-site'}])assert.equal((await fetch(base+path,{method,headers})).status,403);
    const res=await fetch(base+path,{method,headers:{Referer:base+'/watch/episode','Sec-Fetch-Site':'same-origin'}});assert.equal(res.status,200);assert.equal(res.headers.get('set-cookie'),null);
  }
  assert.equal(streamed,4);assert.equal(lookups,1);
  assert.equal((await fetch(base+'/api/playback/session',{method:'POST'})).status,410);
  assert.equal((await fetch(base+'/api/playback/grant',{method:'POST'})).status,410);
  assert.equal((await fetch(base+'/telegram/media/999/7',{headers:{Referer:base+'/watch/episode'}})).status,403);
});
