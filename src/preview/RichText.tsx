import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { TagRegistry } from '../schema/tags';
import { parseText, type ParsedChar, type ResolvedTag } from '../tags/parse';

/**
 * 把特效標記渲染成畫面，並以打字機效果逐字顯示。
 *
 * 這是預覽端的實作。Unity runtime 會用 TMP 頂點動畫做出對應效果 ——
 * 兩端共用 tagRegistry 的定義，但**渲染細節（斷行、字距、動畫曲線）不會完全一致**。
 * 預覽的定位是確認節奏與特效意圖，不是像素級所見即所得。
 */

/** 字型代號 → CSS。Unity 端把同一組代號對應到 TMP 字型資產。 */
const FONT_STACKS: Record<string, string> = {
  title: '"Noto Serif TC", "Songti TC", serif',
  serif: '"Noto Serif TC", serif',
  mono: 'ui-monospace, "Cascadia Code", monospace',
  hand: '"Segoe Script", cursive',
};

const BASE_CHARS_PER_SECOND = 28;

function num(tag: ResolvedTag, key: string, fallback: number): number {
  const value = tag.params[key];
  return typeof value === 'number' ? value : fallback;
}

interface CharVisual {
  style: CSSProperties;
  classNames: string[];
}

function visualFor(char: ParsedChar, index: number): CharVisual {
  const style: CSSProperties = {};
  const classNames: string[] = [];
  const vars = style as CSSProperties & Record<string, string | number>;

  for (const effect of char.effects) {
    switch (effect.name) {
      case 'b':
        style.fontWeight = 700;
        break;
      case 'i':
        style.fontStyle = 'italic';
        break;
      case 'color':
        style.color = String(effect.params.value ?? 'inherit');
        break;
      case 'size':
        style.fontSize = `${num(effect, 'value', 1)}em`;
        break;
      case 'font': {
        const key = String(effect.params.value ?? '');
        style.fontFamily = FONT_STACKS[key] ?? key;
        break;
      }
      case 'shake':
        classNames.push('fx-shake');
        vars['--shake-amp'] = num(effect, 'amp', 2);
        vars['--shake-freq'] = num(effect, 'freq', 20);
        break;
      case 'wave':
        classNames.push('fx-wave');
        vars['--wave-amp'] = num(effect, 'amp', 3);
        vars['--wave-freq'] = num(effect, 'freq', 2);
        vars['--wave-i'] = index;
        break;
    }
  }

  return { style, classNames };
}

/**
 * 事先算出每個字出現的時間點。
 *
 * 用排程表而非「每幀推進一格」，是因為 wait 與 speed 會讓步進速率不固定；
 * 排好表之後播放邏輯就只剩「現在該顯示到第幾個字」，也讓拖曳進度成為可能。
 */
function buildSchedule(chars: ParsedChar[]): { times: number[]; total: number } {
  const times: number[] = [];
  let t = 0;

  for (const char of chars) {
    for (const tag of char.before) {
      if (tag.name === 'wait') t += num(tag, 'value', 0.3);
    }
    // speed 是成對標籤，作用範圍即這個字身上的 effects；巢狀時以最內層為準。
    const speedTag = char.effects.findLast((e) => e.name === 'speed');
    const speed = speedTag ? Math.max(0.05, num(speedTag, 'value', 1)) : 1;
    t += 1 / (BASE_CHARS_PER_SECOND * speed);
    times.push(t);
  }

  return { times, total: t };
}

export interface RichTextProps {
  text: string;
  registry: TagRegistry;
  /** false 時直接顯示全文，不做打字機動畫。 */
  animate: boolean;
  /** 改變這個值會重播。 */
  playToken: number;
  onFinished?: () => void;
}

export function RichText({ text, registry, animate, playToken, onFinished }: RichTextProps) {
  const parsed = useMemo(() => parseText(text, registry), [text, registry]);
  const schedule = useMemo(() => buildSchedule(parsed.chars), [parsed]);
  const [revealed, setRevealed] = useState(parsed.chars.length);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!animate) {
      setRevealed(parsed.chars.length);
      return;
    }

    finishedRef.current = false;
    setRevealed(0);
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      let count = 0;
      while (count < schedule.times.length && schedule.times[count]! <= elapsed) count += 1;
      setRevealed(count);

      if (count >= parsed.chars.length) {
        if (!finishedRef.current) {
          finishedRef.current = true;
          onFinished?.();
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // playToken 是重播的觸發器，故意列入相依。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, playToken, parsed, schedule]);

  return (
    <span className="richtext">
      {parsed.chars.map((char, index) => {
        if (char.char === '\n') return <br key={index} />;

        const { style, classNames } = visualFor(char, index);
        const hidden = index >= revealed;
        return (
          <Fragment key={index}>
            <span
              className={['richtext-char', ...classNames].join(' ')}
              style={{ ...style, visibility: hidden ? 'hidden' : 'visible' }}
            >
              {char.char === ' ' ? ' ' : char.char}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

/** 供編輯器顯示這段文字的標記錯誤。 */
export function useTagIssues(text: string, registry: TagRegistry) {
  return useMemo(() => parseText(text, registry).issues, [text, registry]);
}
