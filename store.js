import {MongoClient} from 'mongodb';

// Only metadata is stored here. Video bytes remain in Telegram/storage.
export function createStore(env,makeClient=(uri,options)=>new MongoClient(uri,options)) {
  let client, pending;
  async function db() {
    if(!env.MONGODB_URI)throw Object.assign(new Error('Set MONGODB_URI in Koyeb to enable the video catalog'),{status:503});
    if(!pending){
      client=makeClient(env.MONGODB_URI,{maxPoolSize:3,minPoolSize:0,maxIdleTimeMS:60000,serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,socketTimeoutMS:15000,waitQueueTimeoutMS:5000});
      pending=client.connect().then(()=>client.db(env.MONGODB_DATABASE||'watch_player')).catch(async()=>{
        await client.close().catch(()=>{});pending=null;
        throw Object.assign(new Error('MongoDB is unavailable; check the Koyeb database configuration'),{status:503});
      });
    }
    return pending;
  }
  return {
    async get(id){const row=await (await db()).collection('videos').findOne({_id:id});return row?.video??null;},
    async put(video){await (await db()).collection('videos').updateOne({_id:video.id},{$set:{video,updatedAt:new Date()}},{upsert:true});},
    async mergeTelegram(parsed){
      // One atomic update avoids losing resolutions when multiple posts arrive together.
      const {id,title,source}=parsed;
      await (await db()).collection('videos').updateOne({_id:id},[{$set:{video:{
        id:{$literal:id},title:{$literal:title},subtitles:{$ifNull:['$video.subtitles',[]]},
        sources:{$concatArrays:[{$filter:{input:{$ifNull:['$video.sources',[]]},as:'s',cond:{$ne:['$$s.height',source.height]}}},{$literal:[source]}]},
      },updatedAt:'$$NOW'}}],{upsert:true});
    },
    async getPost(key){const row=await (await db()).collection('telegram_posts').findOne({_id:key});return row?.entry??null;},
    async putPost(key,entry){await (await db()).collection('telegram_posts').updateOne({_id:key},{$set:{entry}},{upsert:true});},
    async close(){await client?.close();},
  };
}

// Explicit test dependency, never selected by production configuration.
export function createMemoryStore(){
  const videos=new Map(),posts=new Map();
  return {
    async get(id){return structuredClone(videos.get(id)??null);},
    async put(v){videos.set(v.id,structuredClone(v));},
    async mergeTelegram(p){const old=videos.get(p.id);videos.set(p.id,{id:p.id,title:p.title,subtitles:old?.subtitles??[],sources:[...(old?.sources??[]).filter(s=>s.height!==p.source.height),p.source]});},
    async getPost(key){return posts.get(key)??null;},async putPost(key,v){posts.set(key,v);},async close(){},
  };
}
