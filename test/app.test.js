import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp as createServer} from '../server.js';
import {createMemoryStore} from '../store.js';
const createApp=(env,deps={})=>createServer(env,{store:createMemoryStore(),playback:{allowedSite:'https://site.example',authorize(){}},...deps});
import {validateVideo,telegramVideo,publicVideo} from '../catalog.js';
const manifest={id:'episode-01',title:'Episode One',sources:[{height:2160,url:'https://cdn.example/4k.mp4'},{height:480,url:'https://cdn.example/480.mp4'}],subtitles:[{label:'English',language:'en',url:'https://cdn.example/en.vtt'}]};
test('validation sorts lowest first and rejects unsafe URLs and duplicate qualities',()=>{
 assert.equal(validateVideo(manifest).sources[0].height,480);
 assert.throws(()=>validateVideo({...manifest,id:'../bad'}));
 assert.throws(()=>validateVideo({...manifest,sources:[{height:480,url:'javascript:alert(1)'}]}));
 assert.throws(()=>validateVideo({...manifest,sources:[manifest.sources[0],manifest.sources[0]]}));
});
test('Telegram caption groups resolutions, redacts file IDs and marks oversized sources',()=>{
 const p=telegramVideo({chat:{id:-1001},message_id:5,caption:'watch:episode-01 quality:720 Episode One',video:{file_id:'private',file_size:50000000}});
 assert.equal(p.id,'episode-01');assert.equal(p.source.height,720);
 const v=publicVideo({id:p.id,sources:[p.source]});assert.equal(v.sources[0].available,false);assert.ok(!JSON.stringify(v).includes('private'));
});
test('API authentication, import, webhook channel restrictions and player routes',async t=>{
 const server=createApp({ADMIN_TOKEN:'secret',TELEGRAM_WEBHOOK_SECRET:'hook',TELEGRAM_CHANNEL_ID:'-1001',ALLOWED_SITE_ORIGIN:'https://site.example'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post('/api/videos',manifest)).status,401);
 assert.equal((await post('/api/videos',manifest,{Authorization:'Bearer secret'})).status,201);
 let r=await fetch(base+'/api/videos/episode-01',{headers:{Origin:'https://site.example'}});assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal((await r.json()).sources[0].height,480);
 assert.equal((await post('/telegram/webhook',{})).status,401);
 const update={channel_post:{chat:{id:-1001},message_id:1,caption:'watch:test quality:480 Test',video:{file_id:'secret-file',file_size:30000000}}};
 await post('/telegram/webhook',update,{'X-Telegram-Bot-Api-Secret-Token':'hook'});
 const imported=await (await fetch(base+'/api/videos/test')).json();assert.equal(imported.sources[0].available,false);assert.equal(imported.sources[0].fileId,undefined);
 assert.equal((await fetch(base+'/media/test/480')).status,422);
 update.channel_post.chat.id=-999;update.channel_post.caption='watch:bad quality:480';await post('/telegram/webhook',update,{'X-Telegram-Bot-Api-Secret-Token':'hook'});
 assert.equal((await fetch(base+'/api/videos/bad')).status,404);
 const html=await fetch(base+'/watch/episode-01');assert.equal(html.status,200);assert.match(await html.text(),/Video player/);
 assert.equal((await fetch(base+'/api/videos/missing')).status,404);
});
