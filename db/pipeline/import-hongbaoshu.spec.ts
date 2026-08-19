import { describe, expect, it } from 'vitest';
import { parseHongbaoshu, enrichEntries, stageFor, splitSensesByPos } from './import-hongbaoshu';
import type { RawExample, RawWord } from './types';

describe('parseHongbaoshu', () => {
  it('解析必考/基础/超纲分节与单元', () => {
    const content = [
      '#必考词 Unit 1',
      'embrace',
      'embed',
      '#基础词 Unit 2',
      'chat',
      '#基础词汇 Unit 30',
      'acme',
      '#Unit 31 简单基础词汇 之一',
      'abacus',
      '#超纲词 B',
      'banal',
      '#超纲 C',
      'cadence',
    ].join('\n');
    const entries = parseHongbaoshu(content);
    expect(entries).toEqual([
      { word: 'embrace', region: '必考词', unit: 1 },
      { word: 'embed', region: '必考词', unit: 1 },
      { word: 'chat', region: '基础词', unit: 2 },
      { word: 'acme', region: '基础词', unit: 30 },
      { word: 'abacus', region: '基础词', unit: 31 },
      { word: 'banal', region: '超纲词', unit: 2 }, // B→2
      { word: 'cadence', region: '超纲词', unit: 3 }, // C→3
    ]);
  });

  it('空行与未知分节头被跳过', () => {
    const content = ['', '#未知分节', 'someword', '#必考词 Unit 1', 'abandon', '   ', ''].join('\n');
    const entries = parseHongbaoshu(content);
    expect(entries).toEqual([{ word: 'abandon', region: '必考词', unit: 1 }]);
  });
});

describe('stageFor', () => {
  it('必考词 → 1xx，基础词 → 2xx，超纲词 → 3xx', () => {
    expect(stageFor('必考词', 1)).toBe(101);
    expect(stageFor('必考词', 26)).toBe(126);
    expect(stageFor('基础词', 1)).toBe(201);
    expect(stageFor('基础词', 31)).toBe(231);
    expect(stageFor('超纲词', 1)).toBe(301);
    expect(stageFor('超纲词', 26)).toBe(326);
  });
});

describe('splitSensesByPos', () => {
  it('红宝书「；」内联格式：按词性分组，词性内义项合并', () => {
    const meaning = 'n. 地址；网址；演讲；称呼 (方式) vt. 寄往；对…讲话；称呼；处理';
    const senses = splitSensesByPos(meaning, 'address');
    expect(senses).toEqual([
      'n. 地址；网址；演讲；称呼 (方式)',
      'vt. 寄往；对…讲话；称呼；处理',
    ]);
  });

  it('tb_vocabulary「\\n」分段格式：每段一义项', () => {
    const meaning = 'n.地址,通信处,演说,称呼\nv.写姓名地址,演说,向…说话,称呼';
    const senses = splitSensesByPos(meaning, 'address');
    expect(senses).toEqual(['n.地址,通信处,演说,称呼', 'v.写姓名地址,演说,向…说话,称呼']);
  });

  it('多词性 + 连续词性标记（vi. vt.）正确合并', () => {
    const meaning = 'vt. 轻推；(使) 达到，接近；劝说 vi. vt. 用胳膊肘挤开往前钻 n. (肘部的) 轻推，碰';
    const senses = splitSensesByPos(meaning, 'nudge');
    expect(senses).toEqual([
      'vt. 轻推；(使) 达到，接近；劝说',
      'vi. vt. 用胳膊肘挤开往前钻',
      'n. (肘部的) 轻推，碰',
    ]);
  });

  it('无词性标记回退为分隔符切分', () => {
    expect(splitSensesByPos('测试义项；另一义项', 'x')).toEqual(['测试义项', '另一义项']);
  });

  it('空释义返回词本身', () => {
    expect(splitSensesByPos(null, 'word')).toEqual(['word']);
    expect(splitSensesByPos('   ', 'word')).toEqual(['word']);
  });
});

describe('enrichEntries', () => {
  const vocab: RawWord[] = [
    { wordid: 1, spelling: 'radiate', UKphonetic: 'ˈreɪdieɪt', USphonetic: 'ˈrediˌet', paraphrase: 'vt.辐射', frequency: 0.3 },
    { wordid: 2, spelling: 'emphasise', UKphonetic: 'ˈemfəsaɪz', USphonetic: 'ˈemfəsaɪz', paraphrase: 'vt.强调', frequency: 0.5 },
    { wordid: 3, spelling: 'honour', UKphonetic: 'ˈɒnə(r)', USphonetic: 'ˈɑːnər', paraphrase: 'n.荣誉', frequency: 0.4 },
    { wordid: 4, spelling: 'address', UKphonetic: 'əˈdres', USphonetic: 'ˈædres', paraphrase: 'n.地址,通信处,演说,称呼\nv.写姓名地址,演说,向…说话,称呼', frequency: 0.79 },
  ];
  const examples: RawExample[] = [
    { expaid: 1, wordid: 1, en: 'The sun radiates light.', cn: '太阳辐射光。', heat: 1, adddate: '' },
  ];
  const meanings = [
    { word: 'quixotic', meaning: 'adj.堂吉诃德式的' },
    { word: 'address', meaning: 'n. 地址；网址；演讲；称呼 (方式) vt. 寄往；对…讲话；称呼；处理' },
  ];

  it('红宝书释义优先于 tb_vocabulary（address 保留「处理」僻义）', () => {
    const entries = [{ word: 'address', region: '必考词', unit: 1 }];
    const [r] = enrichEntries(entries, vocab, examples, meanings);
    expect(r.paraphrase).toContain('处理');
    expect(r.paraphrase).toContain('地址');
    // 音标/词频仍来自 tb_vocabulary
    expect(r.ukPhonetic).toBe('əˈdres');
    expect(r.frequency).toBe(0.79);
  });

  it('红宝书缺失时回退 tb_vocabulary', () => {
    const entries = [{ word: 'radiate', region: '必考词', unit: 1 }];
    const [r] = enrichEntries(entries, vocab, examples, meanings);
    expect(r.ukPhonetic).toBe('ˈreɪdieɪt');
    expect(r.usPhonetic).toBe('ˈrediˌet');
    expect(r.paraphrase).toContain('辐射');
    expect(r.examples).toHaveLength(1);
    expect(r.frequency).toBe(0.3);
  });

  it('-ise → -ize 变体匹配', () => {
    const entries = [{ word: 'emphasize', region: '基础词', unit: 1 }];
    const [r] = enrichEntries(entries, vocab, examples, meanings);
    expect(r.paraphrase).toContain('强调');
    expect(r.ukPhonetic).toBe('ˈemfəsaɪz');
  });

  it('音标兜底（ECDICT phonetics map）', () => {
    const entries = [{ word: 'honor', region: '基础词', unit: 1 }];
    // honor 在 vocab 无条目 → 靠 ECDICT 音标 map
    const phonetics = { honor: 'ˈɑːnər' };
    const [r] = enrichEntries(entries, vocab, examples, meanings, phonetics);
    expect(r.usPhonetic).toBe('ˈɑːnər');
  });

  it('释义缺失用 words.json 兜底', () => {
    const entries = [{ word: 'quixotic', region: '超纲词', unit: 17 }];
    const [r] = enrichEntries(entries, vocab, examples, meanings);
    expect(r.paraphrase).toContain('堂吉诃德');
    expect(r.ukPhonetic).toBeNull();
  });

  it('无释义词返回 null paraphrase', () => {
    const entries = [{ word: 'nonexistentzzz', region: '超纲词', unit: 1 }];
    const [r] = enrichEntries(entries, vocab, examples, meanings);
    expect(r.paraphrase).toBeNull();
    expect(r.ukPhonetic).toBeNull();
  });
});
