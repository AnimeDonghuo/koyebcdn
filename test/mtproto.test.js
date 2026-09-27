import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {byteRange,sliceChunks,createMTProto} from '../mtproto.js';
import {publicVideo,telegramVideo} from '../catalog.js';

test('byte ranges: full, bounded, open, suffix, invalid and >2 GB offsets',()=>{
  assert.deepEqual(byteRange(undefined,100),{start:0,end:99,partial:false});
  assert.deepEqual(byteRange('bytes=5-9',100),{start:5,end:9,partial:true});
  assert.deepEqual(byteRange('bytes=90-',100),{start:90,end:99,partial:true});
  assert.deepEqual(byteRange('bytes=-20',100),{start:80,end:99,partial:true});
  assert.equal(byteRange('bytes=0-999',100).end,99);
  assert.equal(byteRange('bytes=2147483648-',3*1024**3).start,2147483648);
  for(const range of ['bytes=-','bytes=-0','bytes=100-','bytes=9-5','bytes=0-1,3-4','bytes=9007199254740992-','cats=0-1'])assert.throws(()=>byteRange(range,100),{status:416});
});
test('chunk slicing trims offsets and stops reading once response is complete',async()=>{
  let reads=0;
  async function* chunks(){for(const text of ['abcd','efgh','ijkl','mnop']){reads++;yield Buffer.from(text);}}
  const got=[];for await(const part of sliceChunks(chunks(),3,5))got.push(part);
  assert.equal(Buffer.concat(got).toString(),'defgh');assert.equal(reads,2);
  await assert.rejects(async()=>{for await(const part of sliceChunks(chunks(),0,100))void part;},/Incomplete/);
  const abort=new AbortController();abort.abort();await assert.rejects(async()=>{for await(const part of sliceChunks(chunks(),0,1,abort.signal))void part;},{name:'AbortError'});
});
test('large files are available with MTProto references, private references stay hidden',()=>{
  const v=telegramVideo({chat:{id:-100123},message_id:7,video:{file_id:'secret',file_size:2*1024**3,height:480}});
  const stored={id:v.id,sources:[v.source]};
  assert.equal(publicVideo(stored).sources[0].available,false);
  const exposed=publicVideo(stored,true);assert.equal(exposed.sources[0].available,true);
  for(const key of ['fileId','messageId','channelId','size'])assert.equal(exposed.sources[0][key],undefined);
  assert.equal(createMTProto({TELEGRAM_API_ID:'123',TELEGRAM_API_HASH:'hash'}).enabled,false);
});
test('MTProto transport returns precise 206 and HEAD headers, using bot authorization once',async t=>{
  const bytes=Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');let starts=0,downloads=0;
  const client={setLogLevel(){},async start(options){assert.equal(options.botAuthToken,'bot');starts++;},async destroy(){},async getMessages(channel,options){assert.equal(channel.toString(),'-100123');assert.deepEqual(options.ids,[7]);return [{media:{document:{size:bytes.length,mimeType:'video/mp4'}}}];},async *iterDownload(message,options){downloads++;assert.equal(options.offset,0);assert.equal(options.requestSize,512*1024);yield bytes;}};
  const transport=createMTProto({TELEGRAM_API_ID:'123',TELEGRAM_API_HASH:'hash',TELEGRAM_BOT_TOKEN:'bot'},()=>client);
  const server=http.createServer(async(req,res)=>{try{await transport.stream(req,res,{channelId:'-100123',messageId:7},new AbortController().signal);}catch(e){res.statusCode=e.status||500;res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}`;
  let res=await fetch(url,{headers:{Range:'bytes=7-12'}});assert.equal(res.status,206);assert.equal(res.headers.get('content-range'),'bytes 7-12/36');assert.equal(res.headers.get('content-length'),'6');assert.equal(await res.text(),'789abc');
  res=await fetch(url,{method:'HEAD'});assert.equal(res.status,200);assert.equal(res.headers.get('content-length'),'36');assert.equal(await res.text(),'');assert.equal(downloads,1);assert.equal(starts,1);
  res=await fetch(url,{headers:{Range:'bytes=36-'}});assert.equal(res.status,416);assert.equal(res.headers.get('content-range'),'bytes */36');
  await transport.close();
});
