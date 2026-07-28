import { describe, expect, it } from 'vitest';

import { DEFAULT_TAG_REGISTRY } from '../schema/tags';
import { collectPlaceholders, interpolate } from './interpolate';
import { parseText, stringifyText, stripTags } from './parse';

const R = DEFAULT_TAG_REGISTRY;

const parse = (s: string) => parseText(s, R);
const effectsAt = (s: string, i: number) => parse(s).chars[i]!.effects.map((e) => e.name);

describe('純文字', () => {
  it('沒有標籤時逐字保留', () => {
    const parsed = parse('你好，世界');
    expect(parsed.plain).toBe('你好，世界');
    expect(parsed.issues).toEqual([]);
    expect(parsed.chars.every((c) => c.effects.length === 0)).toBe(true);
  });

  it('轉義的中括號當作字面字元', () => {
    const parsed = parse('按下 \\[Space\\] 繼續');
    expect(parsed.plain).toBe('按下 [Space] 繼續');
    expect(parsed.issues).toEqual([]);
  });

  it('轉義的反斜線', () => {
    expect(parse('a\\\\b').plain).toBe('a\\b');
  });
});

describe('成對標籤', () => {
  it('作用於範圍內的每個字', () => {
    const parsed = parse('前[b]中[/b]後');
    expect(parsed.plain).toBe('前中後');
    expect(effectsAt('前[b]中[/b]後', 0)).toEqual([]);
    expect(effectsAt('前[b]中[/b]後', 1)).toEqual(['b']);
    expect(effectsAt('前[b]中[/b]後', 2)).toEqual([]);
  });

  it('可以巢狀，順序由外而內', () => {
    expect(effectsAt('[b][shake]X[/shake][/b]', 0)).toEqual(['b', 'shake']);
  });

  it('填入未指定參數的預設值', () => {
    const [tag] = parse('[shake]X[/shake]').chars[0]!.effects;
    expect(tag!.params).toEqual({ amp: 2, freq: 20 });
  });

  it('具名參數覆寫預設值', () => {
    const [tag] = parse('[shake amp=5]X[/shake]').chars[0]!.effects;
    expect(tag!.params).toEqual({ amp: 5, freq: 20 });
  });

  it('支援 = 位置參數簡寫', () => {
    const [tag] = parse('[color=#ff3333]X[/color]').chars[0]!.effects;
    expect(tag).toEqual({ name: 'color', params: { value: '#ff3333' } });
  });
});

describe('單點標籤', () => {
  it('掛在下一個字之前', () => {
    const parsed = parse('前[wait=0.5]後');
    expect(parsed.plain).toBe('前後');
    expect(parsed.chars[0]!.before).toEqual([]);
    expect(parsed.chars[1]!.before).toEqual([{ name: 'wait', params: { value: 0.5 } }]);
  });

  it('位在結尾時進 trailing', () => {
    const parsed = parse('結束[sfx=door_close]');
    expect(parsed.plain).toBe('結束');
    expect(parsed.trailing).toEqual([{ name: 'sfx', params: { value: 'door_close' } }]);
  });

  it('同一位置的多個單點標籤依序保留', () => {
    const parsed = parse('[sfx=hit][wait=0.2]痛');
    expect(parsed.chars[0]!.before.map((t) => t.name)).toEqual(['sfx', 'wait']);
  });
});

describe('錯誤處理（永不拋例外）', () => {
  it('未知標籤', () => {
    const parsed = parse('[glitch]X[/glitch]');
    expect(parsed.issues.some((i) => i.message.includes('未知的標籤'))).toBe(true);
    expect(parsed.plain).toBe('X');
  });

  it('沒有結束標籤', () => {
    const parsed = parse('[b]忘了關');
    expect(parsed.issues.some((i) => i.message.includes('沒有結束標籤'))).toBe(true);
    expect(parsed.plain).toBe('忘了關');
  });

  it('多餘的結束標籤', () => {
    expect(parse('X[/b]').issues.some((i) => i.message.includes('多餘的結束標籤'))).toBe(true);
  });

  it('交錯的標籤', () => {
    const parsed = parse('[b][i]X[/b][/i]');
    expect(parsed.issues.some((i) => i.message.includes('不匹配'))).toBe(true);
  });

  it('缺少 ] 時當成字面字元，不吃掉後面的文字', () => {
    const parsed = parse('半個[shake amp=3 標籤');
    expect(parsed.plain).toBe('半個[shake amp=3 標籤');
    expect(parsed.issues.some((i) => i.message.includes('未正確結束'))).toBe(true);
  });

  it('參數型別錯誤', () => {
    expect(parse('[shake amp=很多]X[/shake]').issues[0]!.message).toContain('不是數字');
    expect(parse('[color=紅色]X[/color]').issues[0]!.message).toContain('不是合法色碼');
  });

  it('缺少沒有預設值的必要參數', () => {
    expect(parse('[color]X[/color]').issues[0]!.message).toContain('缺少必要參數');
  });

  it('不存在的參數名', () => {
    expect(parse('[shake power=3]X[/shake]').issues[0]!.message).toContain('沒有參數');
  });

  it('單點標籤被當成成對使用', () => {
    expect(parse('[wait=1]X[/wait]').issues.some((i) => i.message.includes('不需要結束標籤'))).toBe(true);
  });

  it('翻譯者刪掉半邊標籤時會被抓到，不會靜默通過', () => {
    // 匯入 Excel 時最常見的破壞形式：譯者只留下開頭標籤。
    const parsed = parse('You think changing colors will keep you [shake amp=3]alive?');
    expect(parsed.issues).not.toEqual([]);
  });
});

describe('大括號語法（既有劇本的慣例）', () => {
  it('{i} 與 [i] 等價', () => {
    expect(effectsAt('前{i}中{/i}後', 1)).toEqual(['i']);
    expect(parse('前{i}中{/i}後').plain).toBe('前中後');
    expect(parse('前{i}中{/i}後').issues).toEqual([]);
  });

  it('解析劇本中實際出現的三種標記', () => {
    for (const text of ['{i}內心話{/i}', '{color=#606060}灰字{/color}', '{size=130%}放大{/size}']) {
      expect({ text, issues: parse(text).issues }).toEqual({ text, issues: [] });
    }
  });

  it('{color=#606060} 解析出顏色', () => {
    const [tag] = parse('{color=#606060}X{/color}').chars[0]!.effects;
    expect(tag).toEqual({ name: 'color', params: { value: '#606060' } });
  });

  it('百分比換算成倍率：130% → 1.3', () => {
    const [tag] = parse('{size=130%}X{/size}').chars[0]!.effects;
    expect(tag!.params.value).toBe(1.3);
    // 方括號寫法同樣接受百分比。
    expect(parse('[size=80%]X[/size]').chars[0]!.effects[0]!.params.value).toBe(0.8);
  });

  it('兩種括號可以在同一段文字中並存', () => {
    const parsed = parse('{i}斜{/i}與[b]粗[/b]');
    expect(parsed.issues).toEqual([]);
    expect(parsed.plain).toBe('斜與粗');
    expect(effectsAt('{i}斜{/i}與[b]粗[/b]', 0)).toEqual(['i']);
    expect(effectsAt('{i}斜{/i}與[b]粗[/b]', 1)).toEqual([]);
    expect(effectsAt('{i}斜{/i}與[b]粗[/b]', 2)).toEqual(['b']);
  });

  it('可以巢狀混用，只要各自成對', () => {
    expect(effectsAt('{i}[color=#606060]X[/color]{/i}', 0)).toEqual(['i', 'color']);
  });

  it('開頭與結尾的括號不一致會被抓出來', () => {
    const parsed = parse('{i}X[/i]');
    expect(parsed.issues.some((i) => i.message.includes('要用'))).toBe(true);
  });

  it('未閉合的大括號標籤會被抓出來', () => {
    expect(parse('{i}忘了關').issues.some((i) => i.message.includes('沒有結束標籤'))).toBe(true);
  });

  it('轉義的大括號當作字面字元', () => {
    const parsed = parse('變數寫作 \\{name\\}');
    expect(parsed.plain).toBe('變數寫作 {name}');
    expect(parsed.issues).toEqual([]);
  });

  it('不是標籤的大括號原樣保留', () => {
    // 未知標籤才報錯；`{ 1, 2 }` 這種內容連標籤都構不成。
    expect(parse('集合 { 1, 2 }').plain).toBe('集合 { 1, 2 }');
  });
});

describe('尖括號不是標記', () => {
  it('尖括號原樣保留，不會被當成標籤', () => {
    const parsed = parse('前<i>中</i>後');
    expect(parsed.plain).toBe('前<i>中</i>後');
    expect(parsed.issues).toEqual([]);
    expect(parsed.chars.every((c) => c.effects.length === 0)).toBe(true);
  });

  it('不需要轉義尖括號', () => {
    expect(parse('a < b 且 c > d').plain).toBe('a < b 且 c > d');
    expect(parse('a < b 且 c > d').issues).toEqual([]);
  });
});

describe('變數插值', () => {
  const resolve = (name: string) => ({ age: '26', lastName: '柚' })[name];

  it('把 <變數名> 換成值', () => {
    expect(interpolate('欸？！<age>嗎？', resolve).text).toBe('欸？！26嗎？');
  });

  it('帶參數或斜線的尖括號不算插值', () => {
    expect(interpolate('<color=#606060>灰</color>', resolve).text).toBe('<color=#606060>灰</color>');
  });

  it('找不到值時原樣保留，並列在 missing 裡', () => {
    const result = interpolate('你好 <unknownVar>', resolve);
    expect(result.text).toBe('你好 <unknownVar>');
    expect(result.missing).toEqual(['unknownVar']);
  });

  it('插值先於標記解析，替換進來的標記照樣生效', () => {
    const withTag = (name: string) => (name === 'emphasis' ? '[b]很重要[/b]' : undefined);
    const text = interpolate('請注意：<emphasis>', withTag).text;
    expect(parse(text).plain).toBe('請注意：很重要');
    expect(effectsAt(text, 3)).toEqual([]); // 「：」在標記之外
    expect(effectsAt(text, 4)).toEqual(['b']); // 「很」在 [b] 之內
  });

  it('插值後的文字可以正常解析標記', () => {
    const text = interpolate('{i}<age> 歲{/i}', resolve).text;
    expect(parse(text).plain).toBe('26 歲');
    expect(parse(text).issues).toEqual([]);
  });

  it('collectPlaceholders 列出用到的變數', () => {
    expect(collectPlaceholders('{i}<lastName>的<age>{/i}')).toEqual(['lastName', 'age']);
  });
});

describe('stringifyText', () => {
  const roundTrip = (s: string) => stringifyText(parse(s), R);

  it('往返後純文字不變', () => {
    for (const s of [
      '你好，世界',
      '前[b]中[/b]後',
      '[b][shake amp=5]X[/shake][/b]',
      '前[wait=0.5]後',
      '按下 \\[Space\\] 繼續',
      '[speed=0.6]又一個。[wait=0.4][/speed]你以為[shake]活下來[/shake]嗎？',
    ]) {
      expect(parse(roundTrip(s)).plain).toBe(parse(s).plain);
    }
  });

  it('往返後結構與參數不變（正規化後穩定）', () => {
    for (const s of [
      '前[b]中[/b]後',
      '[b][shake amp=5]X[/shake][/b]',
      '[color=#ff3333]紅[/color]白',
      '[speed=0.6]又一個。[wait=0.4][/speed]結束[sfx=hit]',
    ]) {
      const once = roundTrip(s);
      expect(roundTrip(once)).toBe(once);
      expect(parse(once).chars.map((c) => c.effects.map((e) => `${e.name}${JSON.stringify(e.params)}`)))
        .toEqual(parse(s).chars.map((c) => c.effects.map((e) => `${e.name}${JSON.stringify(e.params)}`)));
    }
  });

  it('省略等於預設值的參數', () => {
    expect(roundTrip('[shake amp=2 freq=20]X[/shake]')).toBe('[shake]X[/shake]');
  });

  it('只重新轉義開括號，因為閉括號在標籤外沒有特殊意義', () => {
    expect(roundTrip('按下 \\[Space\\]')).toBe('按下 \\[Space]');
    expect(parse('按下 \\[Space]').plain).toBe('按下 [Space]');
    // 兩種開括號都必須轉義，否則寫出來的字串再解析一次會多出標籤。
    expect(roundTrip('變數 \\{name\\}')).toBe('變數 \\{name}');
  });

  it('可以指定輸出的括號種類', () => {
    expect(stringifyText(parse('{i}X{/i}'), R, 'bracket')).toBe('[i]X[/i]');
    expect(stringifyText(parse('[i]X[/i]'), R, 'brace')).toBe('{i}X{/i}');
  });

  it('含空白的字串值會加引號', () => {
    expect(roundTrip('[font="Noto Sans"]X[/font]')).toBe('[font="Noto Sans"]X[/font]');
  });
});

describe('stripTags', () => {
  it('去掉所有標記', () => {
    expect(stripTags('[speed=0.6]又一個。[wait=0.4][/speed]', R)).toBe('又一個。');
  });
});
