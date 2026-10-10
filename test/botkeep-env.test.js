import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {readFileSync} from 'node:fs';

const startCommand=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).scripts.start;
test('npm start loads Botkeep .env but preserves Koyeb process env; no file also starts',async()=>{
  assert.equal(startCommand,'node --env-file-if-exists=.env server.js');
  const dir=await mkdtemp(join(tmpdir(),'botkeep-env-'));
  const freePort=async()=>{const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));return port;};
  const port=await freePort();
  await writeFile(join(dir,'.env'),`SERVER_PORT=${port}\nTELEGRAM_CHANNEL_IDS=-1002617067511\nMONGODB_DATABASE=botkeep_test\n`);
  async function launch(environment,expectPort){
    const child=spawn(process.execPath,['--env-file-if-exists=.env',resolve('server.js')],{
      cwd:dir,env:{PATH:process.env.PATH,HOME:process.env.HOME,...environment},stdio:['ignore','pipe','pipe'],
    });
    let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
    try{
      await new Promise((ok,fail)=>{
        const timeout=setTimeout(()=>fail(new Error('Startup timeout: '+output)),5000);
        child.stdout.on('data',b=>{if(String(b).includes(`listening on port ${expectPort}`)){clearTimeout(timeout);ok();}});
        child.once('exit',code=>{clearTimeout(timeout);fail(new Error(`Exit ${code}: ${output}`));});
      });
      const res=await fetch(`http://127.0.0.1:${expectPort}/healthz`);assert.equal(res.status,200);
      // Channel-specific route returns 403 or 503 without a real Mongo/Telegram;
      // importantly it must NOT return the 'Set TELEGRAM_CHANNEL_IDS' error.
      const result=await fetch(`http://127.0.0.1:${expectPort}/api/telegram?url=${encodeURIComponent('https://t.me/c/2617067511/22047')}`,{headers:{Referer:`http://127.0.0.1:${expectPort}/watch`}});
      assert.notEqual(result.status,200);
      assert.doesNotMatch(JSON.stringify(await result.json()),/Set TELEGRAM_CHANNEL_IDS/);
    }finally{child.kill();}
  }
  try{
    await launch({},port);
    const override=await freePort();await launch({SERVER_PORT:String(override)},override);
    await rm(join(dir,'.env'));
    const fallback=await freePort();await launch({PORT:String(fallback),TELEGRAM_CHANNEL_IDS:'-1002617067511'},fallback);
  }finally{await rm(dir,{recursive:true,force:true});}
});
