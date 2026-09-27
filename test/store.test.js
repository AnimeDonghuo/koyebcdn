import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {createStore} from '../store.js';

test('MongoDB is lazy, pools are bounded, records upsert by ID, Telegram merge is atomic',async()=>{
  let constructed=0,connected=0,closed=0;const calls=[];
  const fake={async connect(){connected++;return fake;},db(name){assert.equal(name,'player_test');return {collection(collection){return {async findOne(filter){calls.push({collection,filter});return null;},async updateOne(filter,update,options){calls.push({collection,filter,update,options});}};}};},async close(){closed++;}};
  const store=createStore({MONGODB_URI:'mongodb://unused',MONGODB_DATABASE:'player_test'},(uri,options)=>{constructed++;assert.equal(options.maxPoolSize,3);assert.equal(options.serverSelectionTimeoutMS,5000);return fake;});
  assert.equal(constructed,0);
  await Promise.all([store.get('one'),store.getPost('channel/post')]);assert.equal(connected,1);
  await store.put({id:'one',title:'One',sources:[],subtitles:[]});
  await store.mergeTelegram({id:'one',title:'One',source:{height:480,messageId:1,channelId:'-1001'}});
  await store.putPost('channel/post',{fetchedAt:123,value:{title:'Post'}});
  const writes=calls.filter(c=>c.update);assert.equal(writes.length,3);
  assert.ok(writes.every(c=>c.options.upsert===true));
  const merge=writes.find(c=>Array.isArray(c.update));assert.deepEqual(merge.filter,{_id:'one'});
  assert.deepEqual(merge.update[0].$set.video.subtitles,{$ifNull:['$video.subtitles',[]]});
  assert.ok(merge.update[0].$set.video.sources.$concatArrays);
  assert.equal(writes[2].collection,'telegram_posts');
  await store.close();assert.equal(closed,1);
});
test('missing MongoDB configuration fails clearly instead of using ephemeral storage',async()=>{
  const store=createStore({});await assert.rejects(store.get('anything'),{status:503});await store.close();
});
test('real MongoDB persistence and concurrent Telegram quality merging', {skip:!process.env.TEST_MONGODB_URI},async()=>{
  const database=`watch_test_${randomUUID().replaceAll('-','')}`,env={MONGODB_URI:process.env.TEST_MONGODB_URI,MONGODB_DATABASE:database};
  const first=createStore(env),second=createStore(env),cleanup=new MongoClient(env.MONGODB_URI);
  try{
    await first.put({id:'episode',title:'First',sources:[],subtitles:[{language:'en',url:'https://example.test/en.vtt',label:'English'}]});
    await Promise.all([480,1080].map(height=>first.mergeTelegram({id:'episode',title:'Episode',source:{height,messageId:height,channelId:'-1001'}})));
    await first.putPost('channel/1',{fetchedAt:123,value:{title:'Cached'}});
    const persisted=await second.get('episode');assert.equal(persisted.sources.length,2);assert.equal(persisted.subtitles.length,1);
    assert.equal((await second.getPost('channel/1')).value.title,'Cached');
  }finally{await first.close();await second.close();await cleanup.connect();await cleanup.db(database).dropDatabase();await cleanup.close();}
});
