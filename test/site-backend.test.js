import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPlaybackGrantHandler} from '../examples/site-playback-backend.js';
import {DEFAULT_SITE_ORIGIN} from '../playback-auth.js';
test('site helper needs a real site session, checks origin, and keeps issuer key server-side',async t=>{
  let issued=0;
  const key='example-server-key-'.repeat(3);
  const handler=createPlaybackGrantHandler({playerOrigin:'https://player.example',siteOrigin:DEFAULT_SITE_ORIGIN,issuerKey:key,
    authorize:async(req,target)=>req.headers.cookie==='site_session=valid'&&target.id==='episode',
    fetchGrant:async(url,options)=>{issued++;assert.equal(url.href,'https://player.example/api/playback/grant');assert.equal(options.headers.Authorization,`Bearer ${key}`);return {ok:true,async json(){return {token:'short-lived-grant',resource:'video:episode',expiresAt:123};}};},
  });
  const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}/api/playback-token`;
  const post=(headers,body={id:'episode'})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:DEFAULT_SITE_ORIGIN,...headers},body:JSON.stringify(body)});
  assert.equal((await post({})).status,403,'forged Origin alone is not authorization');
  assert.equal((await post({Cookie:'site_session=valid',Origin:'https://copy.example'})).status,403);
  assert.equal((await post({Cookie:'site_session=valid'},{id:'other'})).status,403);
  assert.equal(issued,0);
  const res=await post({Cookie:'site_session=valid'});assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  const body=await res.text();assert.match(body,/short-lived-grant/);assert.ok(!body.includes(key));assert.equal(issued,1);
});
