// 由中公解析出的纯文本（t1..t4.txt + t1_ans..t4_ans.txt）构建 <year>/textN.json
// 用法： node build-year.mjs <year> <rawDir>   （rawDir 内文件名为 t1.txt/t1_ans.txt 等）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const YEAR = process.argv[2];
const RAW = process.argv[3];
const OUT = resolve(import.meta.dirname, YEAR);

// 各年主观字段：篇名副标题 + 题目解析（{ code: { qn: 解析 } }）
const META = {
  '2022': {
    A: { subtitle: '塑料文物的保存难题' },
    B: { subtitle: '学位的价值与Z世代的选择' },
    C: { subtitle: '艺术与科学的合作' },
    D: { subtitle: '新西兰劳动法下的解雇之争' },
  },
};

const ANALYSES = {
  '2022': {
    A: {
      21: '首段末句指出：种类繁多的塑料制品正面临损毁风险，让博物馆等机构“头疼不已”（creates huge headaches for institutions, such as museums, trying to preserve culturally important objects），即维护塑料展品困难。',
      22: '第二段 van Oosten 称早期塑料艺术先驱“并非总能正确配比原料”，好比做蛋糕量错就会失败，说明某些塑料物件先天存在缺陷。',
      23: '第四段提到 Gilardi 的泡沫作品对光尤为脆弱，90 年代中期开裂破碎，博物馆把它们锁进暗处，即停止展出以防进一步损坏。',
      24: '末两段指出塑料保存“只会更难”（will likely get harder），可降解塑料日益普遍使情况更糟，可见作者认为保存塑料有挑战。',
      25: '最后一段 Ferreira 指出考古学家正是在考察馆藏文物后定义了人类历史上的材料时代；我们如今收集和保存什么将影响后世如何看我们，说明保存塑料文物具有深远的历史意义。',
    },
    B: {
      26: '首段即提出值得重新审视学位的意义、价值以及 Z 世代的选择；第二段又指出学位贬值、不再是可靠的社会流动途径，故建议 Z 世代重新评估大学教育的必要性。',
      27: '第二段以英国 28% 毕业生从事非毕业生岗位为例，说明“学位变得普遍后价值被稀释”（As degrees became universal, they became devalued），即反映学位价值缩水。',
      28: '第三、四段称雇主早已看到招聘离校生的好处，并开始取消部分岗位的学位要求，这是好迹象，即雇主对学位态度趋于现实。',
      29: '第五段建议：在已有学位的基础上，最好再具备特定知识或技能（in this age of generalists, it pays to have specific knowledge or skills），即继续深造某一领域。',
      30: '末两段指出 Z 世代将不断“提升技能”（up-skilling）以保持可就业性，教育将成为其职业轨迹的核心部分，说明终身学习将定义他们。',
    },
    C: {
      31: '首段《自然》读者用“启迪、挑战、激发、有趣”等词描述艺术-科学合作体验，且近 40% 受访者表示与艺术家合作过，多数人愿意尝试，即获得积极反响。',
      32: '第三段以悉尼交响乐团重编维瓦尔第《四季》为例：把最新气候预测数据注入古老乐曲，在气候大会前以创作呼吁行动，说明艺术能让观众轻松接触科学。',
      33: '第四段提到受访者指出“艺术家并非只是协助科学家做传播”，其作品也不应仅被当作研究对象，暗示部分艺术家担心自身作用被低估。',
      34: '第五段介绍 MIT 的 CAVS 中心：围绕光这一艺术家与科学家共同兴趣开展项目，成为富有价值的艺术-科学联盟典范。',
      35: '末段强调艺术-科学合作“需超越研究传播这一必要目的”（need to go beyond the necessary purpose of research communication），即应不止于传播科学。',
    },
    D: {
      36: '首两段指出 ERA 个人冤情条款旨在保护普通工人免遭“不公正解雇”，因为普通法契约对管理层随意行为缺乏足够保障。',
      37: '第三段指出这些条款对企业形成约束，阻碍解雇绩效差的高薪经理，成为提升生产率的“手刹”（a handbrake on boosting productivity），即阻碍企业发展。',
      38: '第六段提到生产力委员会把“管理能力低下”列为新西兰生产率增长不佳的原因（singled out the low quality of managerial capabilities），暗示其支持淘汰绩效不佳的经理。',
      39: '第七段称保护法使解雇更贵、雇主招聘更谨慎，且公司因承担雇佣安排出错的风险而支付更少工资（firms pay staff less），即员工面临降薪。',
      40: '末段说澳大利亚用“高收入门槛”解决这一悖论；新西兰 2016 年私人法案效仿，但机制“笨重”（unwieldy）而未被通过，说明门槛难以付诸实践。',
    },
  },
};

function clean(t) {
  return t
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '\u2019').replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
    .replace(/Ferreira' s/g, "Ferreira's");
}

// 把一段英文切成句子（保留引号/缩写尽量安全）
function splitSentences(para) {
  const out = [];
  for (const m of para.matchAll(/[^.!?]+[.!?]*["\u201D)]?/g)) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

function parseTextFile(path) {
  const lines = readFileSync(path, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
  const ti = lines.findIndex((l) => /^Text [1-4]$/i.test(l));
  const qi = lines.findIndex((l) => /^\d+\.\s/.test(l));
  const paras = lines.slice(ti + 1, qi).filter((l) => !/^\[[A-D]\]\s/.test(l));
  const paragraphs = [];
  for (const p of paras) {
    if (/^\d+\.\s/.test(p)) break;
    paragraphs.push(p);
  }
  const questions = [];
  for (let i = qi; i < lines.length; i++) {
    const qm = lines[i].match(/^(\d+)\.\s*(.+)$/);
    if (qm) {
      const q = { seq: Number(qm[1]), stem: clean(qm[2]), options: {} };
      for (let j = i + 1; j < lines.length; j++) {
        const om = lines[j].match(/^\[([A-D])\]\s*(.+)$/);
        if (om) q.options[om[1]] = clean(om[2]);
        else break;
      }
      questions.push(q);
    }
  }
  return { paragraphs, questions };
}

function parseAnswerFile(path) {
  const map = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^(\d+)\.\s*\[([A-D])\]\s*/);
    if (m) map[Number(m[1])] = m[2];
  }
  return map;
}

const codeLetter = ['t1', 't2', 't3', 't4'];
const code = ['A', 'B', 'C', 'D'];
const metaYear = META[YEAR] ?? {};
const analysesYear = ANALYSES[YEAR] ?? {};

mkdirSync(OUT, { recursive: true });
for (let i = 0; i < 4; i++) {
  const { paragraphs, questions } = parseTextFile(resolve(RAW, `${codeLetter[i]}.txt`));
  const answers = parseAnswerFile(resolve(RAW, `${codeLetter[i]}_ans.txt`));
  const sentences = [];
  let seq = 0;
  paragraphs.forEach((p, pi) => {
    for (const s of splitSentences(clean(p))) {
      sentences.push({ para: pi + 1, seq: seq++, en: s });
    }
  });
  const title = `Text ${i + 1}`;
  const outQ = questions.map((q) => {
    const answer = answers[q.seq];
    if (!answer) throw new Error(`${YEAR} ${code[i]} 缺少第 ${q.seq} 题答案`);
    const analysis = analysesYear[code[i]]?.[q.seq] ?? '（解析待补充）';
    return { ...q, answer, analysis };
  });
  const file = {
    code: code[i],
    title,
    subtitle: metaYear[code[i]]?.subtitle ?? '',
    questionsStart: questions[0]?.seq ?? 21,
    sentences,
    questions: outQ,
    glossary: {},
  };
  const p = resolve(OUT, `text${i + 1}.json`);
  writeFileSync(p, JSON.stringify(file, null, 2), 'utf-8');
  console.log(`[ok] ${YEAR}/${code[i]} ${title}：句子 ${sentences.length}、题目 ${outQ.length}`);
}