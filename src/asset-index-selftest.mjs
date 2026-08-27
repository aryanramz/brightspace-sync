import assert from 'node:assert/strict';
import { isStructuralResourceCandidate } from './crawler.mjs';

assert.equal(
  isStructuralResourceCandidate({ href: 'https://example.edu/d2l/home/123', tag: 'a', force: false }),
  false,
  'normal navigation anchors must not be treated as assets'
);

assert.equal(
  isStructuralResourceCandidate({ href: 'https://example.edu/file.pdf', tag: 'a', force: false }),
  true,
  'download-looking links should be indexed as assets'
);

assert.equal(
  isStructuralResourceCandidate({ href: 'https://cdn.example.edu/image', tag: 'img', force: false }),
  true,
  'embedded images should be indexed as assets'
);

assert.equal(
  isStructuralResourceCandidate({ href: 'https://example.edu/resource', tag: 'a', force: true }),
  true,
  'explicit download/data-location resources should be indexed as assets'
);

console.log('Asset index self-test: PASS');
