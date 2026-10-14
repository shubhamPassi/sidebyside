export function parseYouTube(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Paste a valid YouTube video URL.');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('Paste a full YouTube URL, including https://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a YouTube video link.');
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(embed|shorts|live)\//.test(url.pathname)) id = url.pathname.split('/')[2];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('That link is not a YouTube video. Playlists are not supported.');
  if (url.pathname.startsWith('/live/')) throw new Error('Choose an on-demand video; live streams are not supported.');
  return id;
}
