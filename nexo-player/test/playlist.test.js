import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isMasterPlaylist,
  parseAttributes,
  parseMasterPlaylist,
  dedupeByHeight,
  qualityLabel,
} from '../src/playlist.js';
import { MASTER_PLAYLIST, MEDIA_PLAYLIST } from '../testkit/fixtures.mjs';

const BASE = 'https://cdn.test-video.com/hls/abc123/master.m3u8';

test('isMasterPlaylist: distingue master de media', () => {
  assert.equal(isMasterPlaylist(MASTER_PLAYLIST), true);
  assert.equal(isMasterPlaylist(MEDIA_PLAYLIST), false);
  assert.equal(isMasterPlaylist(''), false);
  assert.equal(isMasterPlaylist(undefined), false);
});

test('parseAttributes: respeta comas dentro de comillas', () => {
  const attrs = parseAttributes(
    'BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"'
  );
  assert.equal(attrs.BANDWIDTH, '2800000');
  assert.equal(attrs.RESOLUTION, '1280x720');
  assert.equal(attrs.CODECS, 'avc1.64001f,mp4a.40.2');
});

test('parseAttributes: tolera entradas raras', () => {
  assert.deepEqual(parseAttributes(undefined), {});
  assert.deepEqual(parseAttributes(''), {});
});

test('parseMasterPlaylist: resuelve URIs relativas contra la URL base', () => {
  const variants = parseMasterPlaylist(MASTER_PLAYLIST, BASE);
  assert.equal(
    variants[0].url,
    'https://cdn.test-video.com/hls/abc123/1080p-high/index.m3u8'
  );
});

test('parseMasterPlaylist: ordena de mayor a menor resolución', () => {
  const heights = parseMasterPlaylist(MASTER_PLAYLIST, BASE).map((v) => v.height);
  assert.deepEqual(heights, [1080, 720, 480, 360]);
});

test('parseMasterPlaylist: deja una sola variante por altura, la de más bitrate', () => {
  const variants = parseMasterPlaylist(MASTER_PLAYLIST, BASE);
  assert.equal(variants.length, 4);
  const fullHD = variants.find((v) => v.height === 1080);
  assert.equal(fullHD.bandwidth, 9000000);
});

test('parseMasterPlaylist: devuelve [] para una playlist media', () => {
  assert.deepEqual(parseMasterPlaylist(MEDIA_PLAYLIST, BASE), []);
});

test('parseMasterPlaylist: ignora variantes sin URI', () => {
  const text = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=320x240\n#EXT-X-ENDLIST\n';
  assert.deepEqual(parseMasterPlaylist(text, BASE), []);
});

test('parseMasterPlaylist: maneja URIs absolutas y sin RESOLUTION', () => {
  const text = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000
https://other.test/x/index.m3u8
`;
  const [v] = parseMasterPlaylist(text, BASE);
  assert.equal(v.url, 'https://other.test/x/index.m3u8');
  assert.equal(v.height, null);
  assert.equal(v.bandwidth, 500000);
});

test('parseMasterPlaylist: descarta URIs imposibles de resolver', () => {
  const text = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttp://[mala\n';
  assert.deepEqual(parseMasterPlaylist(text, BASE), []);
});

test('dedupeByHeight: sin alturas conocidas no colapsa las variantes', () => {
  const list = [
    { url: 'https://a/1.m3u8', height: null, bandwidth: 1 },
    { url: 'https://a/2.m3u8', height: null, bandwidth: 2 },
  ];
  assert.equal(dedupeByHeight(list).length, 2);
});

test('qualityLabel: resolución y bitrate legibles', () => {
  assert.equal(qualityLabel({ height: 1080, bandwidth: 5000000 }), '1080p · 5.0 Mbps');
  assert.equal(qualityLabel({ height: 720, bandwidth: null }), '720p');
  assert.equal(qualityLabel({ height: null, bandwidth: 1500000 }), '1.5 Mbps');
  assert.equal(qualityLabel({}), '');
});
