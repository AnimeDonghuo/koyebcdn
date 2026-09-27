import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubtitles,MAX_SUBTITLE_BYTES,decodeSubtitleBytes} from '../public/subtitle-utils.js';

test('SRT parsing handles BOM, CRLF, cue numbering and plain-text safety',()=>{
  const cues=parseSubtitles('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n<b>Hello</b> &amp; welcome\r\nsecond line\r\n\r\n2\r\n00:00:05,000 --> 00:00:04,000\r\nInvalid reverse cue','test.srt');
  assert.deepEqual(cues,[{start:1.25,end:3.5,text:'Hello & welcome\nsecond line'}]);
});
test('WebVTT parsing accepts identifiers/settings and skips comments/styles',()=>{
  const text='WEBVTT\n\nNOTE generated\nignored\n\nSTYLE\n::cue { color: red }\n\nfirst\n00:02.000 --> 00:04.000 align:start\n<v Narrator>Welcome</v>\n\n00:05.000 --> 00:06.500\nNext';
  assert.deepEqual(parseSubtitles(text,'en.VTT'),[{start:2,end:4,text:'Welcome'},{start:5,end:6.5,text:'Next'}]);
});
test('ASS/SSA parsing preserves commas/newlines while dropping styles and drawings',()=>{
  const text='[Script Info]\nTitle: test\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.20,0:00:02.50,Default,,0,0,0,,{\\i1}Hello, world\\NNext\\hline\nDialogue: 0,0:00:02.50,0:00:03.00,Default,,0,0,0,,{\\p1}m 0 0 l 1 1';
  assert.deepEqual(parseSubtitles(text,'test.ass'),[{start:1.2,end:2.5,text:'Hello, world\nNext line'}]);
});
test('subtitle limits and invalid inputs fail clearly',()=>{
  assert.throws(()=>parseSubtitles('x'.repeat(MAX_SUBTITLE_BYTES+1),'test.srt'),/2 MB/);
  assert.throws(()=>parseSubtitles('WEBVTT','test.exe'),/Choose an/);
  assert.throws(()=>parseSubtitles('invalid','test.vtt'),/header/);
  assert.throws(()=>parseSubtitles('1\n00:66:00,000 --> 00:67:00,000\nInvalid','test.srt'),/No supported/);
  const cue='00:00:01,000 --> 00:00:02,000\nTest\n\n';
  assert.throws(()=>parseSubtitles(cue.repeat(10001),'test.srt'),/too many cues/);
});

test('subtitle decoding supports UTF-8 and BOM-marked UTF-16 without silent corruption',()=>{
  const text='1\n00:00:01,000 --> 00:00:02,000\nहिन्दी subtitles\n';
  const little=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text,'utf16le')]);
  assert.equal(decodeSubtitleBytes(little),text);
  assert.equal(decodeSubtitleBytes(Buffer.from(text,'utf8')),text);
  const big=Buffer.from(little);big.swap16();assert.equal(decodeSubtitleBytes(big),text);
  assert.throws(()=>decodeSubtitleBytes(Uint8Array.from([0xff,0xff,0xff])),/encoding/);
  assert.throws(()=>decodeSubtitleBytes(new Uint8Array(MAX_SUBTITLE_BYTES+1)),/2 MB/);
});
