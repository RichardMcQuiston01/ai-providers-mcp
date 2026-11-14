import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  Result,
  TextResult,
  ImageResult,
} from '@richardmcquiston01/ai-providers';
import { FakeImageGenerator, FakeTextGenerator } from './fakes.js';

test('FakeTextGenerator returns canned text and records requests', async () => {
  const generator: FakeTextGenerator = new FakeTextGenerator(
    'fake',
    'm',
    'hello'
  );
  const result: Result<TextResult> = await generator.generateText({
    instructions: '',
    prompt: 'hi',
  });
  assert.deepEqual(result, { ok: true, value: { text: 'hello' } });
  assert.equal(generator.requests.length, 1);
});

test('fakes return a descriptive error Result instead of throwing', async () => {
  const text: FakeTextGenerator = new FakeTextGenerator(
    'fake',
    'm',
    '',
    'fake: HTTP 500 from fake-model'
  );
  const textResult: Result<TextResult> = await text.generateText({
    instructions: '',
    prompt: 'x',
  });
  assert.equal(textResult.ok, false);

  const image: FakeImageGenerator = new FakeImageGenerator();
  const imageResult: Result<ImageResult> = await image.generateImage({
    instructions: '',
    prompt: 'x',
    images: [],
    mode: null,
  });
  assert.equal(imageResult.ok, false);
});
