import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { currentCellMap } from '../excel/rows';
import { parseText } from '../tags/parse';
import { cellKey, parseCellKey } from './keys';
import { DEFAULT_TAG_REGISTRY } from './tags';
import { createChoice, createEmptyProject, createNode, createScene } from './factory';
import { StoryProjectSchema, type StoryProject } from './story';
import { checkReferences, validateStoryProject } from './validate';

const SAMPLE_PATH = fileURLToPath(new URL('../../samples/demo.story.json', import.meta.url));

function loadSample(): unknown {
  return JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
}

/** 取一份通過驗證的樣本，供各測試自由破壞。 */
function parsedSample(): StoryProject {
  return StoryProjectSchema.parse(loadSample());
}

describe('sample project', () => {
  it('通過 schema 與參照完整性檢查', () => {
    const result = validateStoryProject(loadSample());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('每一段文字都能用該專案的 tagRegistry 無誤解析', () => {
    // 參照完整性檢查看不到標記語法，而樣本正是文件與 demo 的門面 ——
    // 曾經出現過樣本使用「registry 裡不存在的用法」而無人察覺的情況。
    const project = parsedSample();
    const nodes = project.scenes.flatMap((s) => s.nodes);
    const texts = [
      ...nodes.flatMap((n) => Object.values(n.text)),
      ...nodes.flatMap((n) => n.choices).flatMap((c) => Object.values(c.text)),
      ...project.characters.flatMap((c) => Object.values(c.name)),
    ];

    for (const text of texts) {
      expect({ text, issues: parseText(text, project.tagRegistry).issues }).toEqual({ text, issues: [] });
    }
  });

  it('樣本的 tagRegistry 與編輯器預設一致', () => {
    // 兩者漂移時，樣本會示範出使用者實際上打不出來的語法。
    expect(parsedSample().tagRegistry).toEqual(DEFAULT_TAG_REGISTRY);
  });
});

describe('參照完整性', () => {
  it('抓出指向不存在節點的 next', () => {
    const project = parsedSample();
    project.scenes[0]!.nodes[0]!.next = '01KYJCW9TQKZDPGVV5H86A0QF2';

    const result = validateStoryProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.endsWith('.next'))).toBe(true);
  });

  it('抓出重複的 node id', () => {
    const project = parsedSample();
    const nodes = project.scenes[0]!.nodes;
    nodes[1]!.id = nodes[0]!.id;

    const result = validateStoryProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('id 重複'))).toBe(true);
  });

  it('抓出基準語言台詞為空', () => {
    const project = parsedSample();
    project.scenes[0]!.nodes[0]!.text.zh = '   ';

    const result = validateStoryProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('基準語言的台詞'))).toBe(true);
  });

  it('抓出 action 的變數型別不符', () => {
    const project = parsedSample();
    project.scenes[0]!.nodes[1]!.actions = [{ op: 'add', variable: 'met_warden', value: 1 }];

    const result = validateStoryProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('add 只能用於 number'))).toBe(true);
  });

  it('抓出格式主版本不符', () => {
    const project = parsedSample();
    project.meta.formatVersion = '2.0.0';

    const result = validateStoryProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'meta.formatVersion')).toBe(true);
  });

  it('未翻譯的語言只算 warning，不算 error', () => {
    const project = parsedSample();
    delete project.scenes[0]!.nodes[0]!.text.en;

    const result = validateStoryProject(project);
    expect(result.ok).toBe(true);
  });

  it('拒絕非 ULID 的 id', () => {
    const project = parsedSample() as unknown as { scenes: { nodes: { id: string }[] }[] };
    project.scenes[0]!.nodes[0]!.id = 'scene_01_003';

    expect(validateStoryProject(project).ok).toBe(false);
  });
});

describe('舊版本檔案的相容性', () => {
  /** 1.0.0 的檔案：沒有 kind / branches / extras / expression。 */
  function legacyProject(): unknown {
    return {
      meta: {
        formatVersion: '1.0.0',
        projectName: '舊檔',
        languages: ['zh'],
        baseLanguage: 'zh',
        updatedAt: '',
      },
      tagRegistry: DEFAULT_TAG_REGISTRY,
      variables: [],
      characters: [],
      scenes: [
        {
          id: '01KYJCW9TK5KTA2ZM25PGHS8AA',
          name: '第一幕',
          entryNodeId: '01KYJCW9TNZVMPJSWTW342D9DC',
          nodes: [
            {
              id: '01KYJCW9TNZVMPJSWTW342D9DC',
              text: { zh: '舊檔的台詞。' },
              choices: [],
              next: null,
              actions: [],
              notes: '',
            },
          ],
        },
      ],
      exportSnapshot: null,
    };
  }

  it('通過驗證，且回傳的 project 已補上新欄位的預設值', () => {
    const result = validateStoryProject(legacyProject());

    expect(result.ok).toBe(true);
    // 回傳的必須是 Zod 的輸出而非原始 JSON —— 否則新欄位是 undefined，
    // 任何走訪 node.branches 的程式碼都會在執行期爆掉。
    const node = result.project!.scenes[0]!.nodes[0]!;
    expect(node.kind).toBe('line');
    expect(node.branches).toEqual([]);
    expect(node.extras).toEqual({});
  });

  it('補齊後的專案可以直接餵給後續流程而不會拋錯', () => {
    const project = validateStoryProject(legacyProject()).project!;

    expect(() => checkReferences(project)).not.toThrow();
    expect(() => currentCellMap(project)).not.toThrow();
  });
});

describe('Excel 定址', () => {
  it('cellKey 與 parseCellKey 往返一致', () => {
    const ref = { ownerKind: 'choice' as const, ownerId: '01KYJCW9TN0K7ND0EMFVAMJ3BV' };

    expect(parseCellKey(cellKey(ref, 'text', 'zh'))).toEqual({ ...ref, field: 'text', lang: 'zh' });
    expect(parseCellKey(cellKey(ref, 'notes', null))).toEqual({ ...ref, field: 'notes', lang: null });
  });

  it('拒絕格式不正確的 key', () => {
    expect(parseCellKey('node:01KYJ:text')).toBeNull();
    expect(parseCellKey('widget:01KYJ:text:zh')).toBeNull();
    expect(parseCellKey('node:01KYJ:colour:zh')).toBeNull();
  });

  it('涵蓋樣本中所有台詞、選項、備註與角色名', () => {
    const project = parsedSample();
    const cells = currentCellMap(project);

    const nodes = project.scenes.flatMap((s) => s.nodes);
    const choices = nodes.flatMap((n) => n.choices);
    const langs = project.meta.languages.length;
    // 節點：每語言一格台詞 + 一格備註；選項與角色：每語言一格。
    expect(Object.keys(cells)).toHaveLength(
      nodes.length * (langs + 1) + (choices.length + project.characters.length) * langs,
    );
  });

  it('重排節點不改變 key 集合（合併正確性的前提）', () => {
    const before = new Set(Object.keys(currentCellMap(parsedSample())));

    const project = parsedSample();
    project.scenes[0]!.nodes.reverse();

    expect(new Set(Object.keys(currentCellMap(project)))).toEqual(before);
  });
});

describe('factory', () => {
  it('產生的空專案本身就是合法的', () => {
    expect(validateStoryProject(createEmptyProject('新專案', ['zh', 'en'])).ok).toBe(true);
  });

  it('每次建立都給不同的 id', () => {
    const a = createNode({ text: { zh: 'a' } });
    const b = createNode({ text: { zh: 'b' } });
    expect(a.id).not.toBe(b.id);
  });

  it('createScene 預設以第一個節點為進入點', () => {
    const first = createNode({ text: { zh: '第一句' } });
    const scene = createScene('測試', [first, createNode({ text: { zh: '第二句' } })]);
    expect(scene.entryNodeId).toBe(first.id);
  });

  it('組出的專案通過完整驗證', () => {
    const ending = createNode({ text: { zh: '結束。' } });
    const opening = createNode({
      text: { zh: '開始。' },
      choices: [createChoice({ text: { zh: '繼續' }, targetNodeId: ending.id })],
    });

    const project = createEmptyProject('組裝測試');
    project.scenes = [createScene('唯一場景', [opening, ending])];

    const result = validateStoryProject(project);
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('寫劇本時容易踩到的兩個坑', () => {
  const withText = (text: string): StoryProject => {
    const project = createEmptyProject('測試', ['zh']);
    project.scenes = [createScene('第一幕', [createNode({ text: { zh: text } })])];
    return project;
  };

  it('size 漏打 % 會被指出來', () => {
    // {size=130%} 是 1.3 倍、{size=130} 是 130 倍，兩者都解析成功、都不報錯。
    const issues = checkReferences(withText('{size=130}好大{/size}'));
    const hit = issues.find((i) => i.message.includes('130 倍'));
    expect(hit?.level).toBe('warning');
  });

  it('合理的倍率不會被誤報', () => {
    for (const text of ['{size=130%}x{/size}', '[size=1.5]x[/size]', '[size=0.5]x[/size]']) {
      expect(checkReferences(withText(text)).filter((i) => i.message.includes('倍'))).toEqual([]);
    }
  });

  it('變數名撞到 TMP 標記會被指出來', () => {
    const project = createEmptyProject('測試', ['zh']);
    project.variables = [{ id: 'b', type: 'bool', default: false, description: '' }];
    const hit = checkReferences(project).find((i) => i.path === 'variables.b');
    expect(hit?.level).toBe('warning');
    expect(hit?.message).toContain('TextMeshPro');
  });

  it('正常的變數名不會被誤報', () => {
    const project = createEmptyProject('測試', ['zh']);
    project.variables = [
      { id: 'birthday', type: 'date', default: '', description: '' },
      { id: 'composure', type: 'number', default: 0, description: '' },
    ];
    expect(checkReferences(project).filter((i) => i.path.startsWith('variables.'))).toEqual([]);
  });
});
