// Test-only media. FFmpeg is NOT installed or invoked in the Koyeb application.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
export function generateMedia(){
  const directory=resolve(process.env.MEDIA_FIXTURE_DIR||'.cache/media-fixtures');mkdirSync(directory,{recursive:true});
  const ffmpeg=process.env.FFMPEG_BIN||'ffmpeg';
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x242434:s=320x180:r=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','8','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','32k','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=hin','-disposition:a:0','default','-disposition:a:1','0','-movflags','+faststart','-y',`${directory}/dual-audio.mp4`]);
  writeFileSync(`${directory}/english.vtt`,'WEBVTT\n\n00:00.000 --> 00:08.000\nEnglish subtitle test\n');
  writeFileSync(`${directory}/hindi.srt`,'1\n00:00:00,000 --> 00:00:08,000\nहिन्दी उपशीर्षक परीक्षण\n');
  return directory;
}
