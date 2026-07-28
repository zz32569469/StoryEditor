/**
 * 由 Zod schema 產生 JSON Schema，供 Unity 端手寫 C# DTO 時對照。
 *
 * 產物 (docs/story.schema.json) 納入版控 —— 它就是網頁端與 Unity 端之間的契約書面。
 * 改動 Zod schema 後務必重跑，讓 diff 顯示格式變更。
 *
 *   npm run gen:schema
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { FORMAT_VERSION, StoryProjectSchema } from '../src/schema/story';

const OUT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'docs/story.schema.json');

const jsonSchema = z.toJSONSchema(StoryProjectSchema, { io: 'output' });

const document = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://storyeditor.local/story-${FORMAT_VERSION}.schema.json`,
  title: `StoryProject ${FORMAT_VERSION}`,
  ...jsonSchema,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`wrote ${OUT}`);
