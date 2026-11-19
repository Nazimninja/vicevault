/**
 * IndexNow Instant Search Engine Indexing Script
 * Submits all verified URLs from sitemap.xml to IndexNow (Bing, Yandex, Seznam, Naver)
 * 
 * Usage: agy-node indexnow_submit.js (or node indexnow_submit.js)
 */

const fs = require('fs');
const https = require('https');

const HOST = 'vicevault.linkwa.in';
const KEY = '8f7f1ad4b9714ebca808d4b3c95e1d90';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

// Read URLs directly from sitemap.xml
const sitemapContent = fs.readFileSync('sitemap.xml', 'utf8');
const urls = [...sitemapContent.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

console.log(`Found ${urls.length} URLs in sitemap.xml to submit to IndexNow...`);

const payload = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: KEY_LOCATION,
  urlList: urls
});

const req = https.request('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  console.log(`IndexNow API Response Status: ${res.statusCode} ${res.statusMessage}`);
  let responseData = '';
  res.on('data', chunk => responseData += chunk);
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 202) {
      console.log('✓ Successfully submitted URLs to IndexNow! Search engines will prioritize crawling these URLs.');
    } else {
      console.log('Response body:', responseData || '(empty)');
    }
  });
});

req.on('error', (err) => {
  console.error('Error submitting to IndexNow:', err.message);
});

req.write(payload);
req.end();
