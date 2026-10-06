// Renders the Moby brand assets (issue: app logo). Run: npm i --no-save sharp && node render.js
/* global Buffer */
const sharp = require('sharp');
const fs = require('fs');
const mark = fs.readFileSync('moby-mark.svg', 'utf8');
const markInner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const svg = (body, bg = '') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg}${body}</svg>`);
const at = (scale) => `<g transform="translate(${512 - 512 * scale} ${512 - 512 * scale + 24 * scale}) scale(${scale})">${markInner}</g>`;
const bg = `<defs><radialGradient id="bg" cx="0.3" cy="0.2" r="1"><stop offset="0" stop-color="#174A6E"/><stop offset="0.55" stop-color="#0E2A44"/><stop offset="1" stop-color="#0B1F33"/></radialGradient><radialGradient id="glow" cx="0.5" cy="0.47" r="0.5"><stop offset="0" stop-color="#2DD4BF" stop-opacity="0.35"/><stop offset="1" stop-color="#2DD4BF" stop-opacity="0"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#bg)"/><circle cx="512" cy="480" r="420" fill="url(#glow)"/>`;
// Themed icons use alpha only: the pin is solid and the dot and arcs are cut out of it.
const holes = markInner.replace(/<defs>[\s\S]*?<\/defs>/, '').replace(/<path d="M512 868[^>]*\/>/, '').replace(/#F4F7FA/g, '#000000');
const mono = `<defs><mask id="m"><rect width="1024" height="1024" fill="#fff"/>${holes}</mask></defs>` +
  `<path d="M512 868 C 430 768, 282 612, 282 430 A 230 230 0 1 1 742 430 C 742 612, 594 768, 512 868 Z" fill="#FFFFFF" mask="url(#m)"/>`;
const out = async (name, buf, size) => sharp(buf).resize(size, size).png().toFile(name);
(async () => {
  await out('../icon.png', svg(at(0.78), bg), 1024);                       // iOS + default icon
  await out('../android-icon-background.png', svg('', bg), 1024);           // adaptive background
  await out('../android-icon-foreground.png', svg(at(0.56)), 1024);         // inside the 66% safe zone
  await out('../android-icon-monochrome.png', svg(`<g transform="translate(225 235) scale(0.56)">${mono}</g>`), 1024); // themed icons (Android 13+)
  await out('../splash-icon.png', svg(at(0.9)), 1024);                     // centred on the navy splash
  await out('../favicon.png', svg(at(0.86), bg), 48);
  await out('moby-mark.png', svg(at(0.95)), 1024);                     // transparent, for decks
  await out('moby-icon-preview.png', svg(at(0.78), bg), 512);
  console.log('rendered');
})();
