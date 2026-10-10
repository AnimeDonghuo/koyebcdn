import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePort} from '../server.js';
import {createSitePlaybackAuth} from '../site-playback-auth.js';

test('listening port follows SERVER_PORT then PORT, default 8000, invalid values fail clearly',()=>{
  assert.equal(resolvePort({}),8000);
  assert.equal(resolvePort({PORT:''}),8000);
  assert.equal(resolvePort({PORT:'3000'}),3000);
  assert.equal(resolvePort({SERVER_PORT:'32728',PORT:'3000'}),32728,'Botkeep assigns SERVER_PORT');
  assert.equal(resolvePort({SERVER_PORT:'',PORT:'3000'}),3000);
  assert.throws(()=>resolvePort({PORT:'not-a-port'}),/PORT must be a TCP port/);
  assert.throws(()=>resolvePort({SERVER_PORT:'70000'}),/SERVER_PORT must be a TCP port/);
});
const req=(headers)=>({headers:{'sec-fetch-site':'same-origin',referer:'https://player.example/watch/test',...headers}});
test('site checks accept a proxy-forwarded public host but not forged or internal-only hosts',()=>{
  const auth=createSitePlaybackAuth({});
  assert.deepEqual(auth.authorize(req({'x-forwarded-host':'player.example',host:'127.0.0.1:32728'}),{resource:'v'}),{resource:{resource:'v'}});
  assert.throws(()=>auth.authorize(req({host:'127.0.0.1:32728'})),{status:403},'internal Host alone is not enough');
  assert.throws(()=>auth.authorize(req({host:'player.example','x-forwarded-host':'evil.example'})),{status:403});
  assert.throws(()=>auth.authorize(req({host:'player.example',referer:'https://other.example/watch/test'})),{status:403});
});
test('optional public PLAYER_ORIGIN matches the real domain behind any internal proxy host',()=>{
  const auth=createSitePlaybackAuth({PLAYER_ORIGIN:'https://watch.bot-keep.xyz'});
  assert.deepEqual(auth.authorize(req({host:'node1.internal:32728',referer:'https://watch.bot-keep.xyz/watch/test'}),{}),{resource:{}});
  assert.throws(()=>auth.authorize(req({host:'node1.internal:32728',referer:'https://player.example/watch/test'})),{status:403});
  assert.throws(()=>createSitePlaybackAuth({PLAYER_ORIGIN:'http://watch.bot-keep.xyz'}),/PLAYER_ORIGIN must be one exact HTTPS origin/);
  assert.throws(()=>createSitePlaybackAuth({PLAYER_ORIGIN:'https://watch.bot-keep.xyz/app'}),/PLAYER_ORIGIN must be one exact HTTPS origin/);
});

test('npm start listens on the Botkeep assigned SERVER_PORT with a live health route',async()=>{
  const {spawn}=await import('node:child_process');
  const {createServer}=await import('node:net');
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,SERVER_PORT:String(port),PORT:'8000'},stdio:['ignore','pipe','pipe']});
  let output='';child.stderr.on('data',b=>{output+=b;});child.stdout.on('data',b=>{output+=b;});
  try{
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error(`Startup timed out: ${output}`)),5000);
      child.stdout.on('data',b=>{if(String(b).includes(`listening on port ${port}`)){clearTimeout(timeout);resolve();}});
      child.on('exit',code=>{clearTimeout(timeout);reject(new Error(`Startup exited ${code}: ${output}`));});
    });
    const response=await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  }finally{child.kill();}
});
