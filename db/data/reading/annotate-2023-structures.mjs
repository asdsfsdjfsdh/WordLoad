// 一次性生成器：为 2023 四篇 66 句生成句子结构标注（needle 定位 → 精确原文切片）
// 用法: node gen-structures.mjs   →  写入 db/data/reading/structures.json
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const READING_ROOT = resolve('db/data/reading/2023');

// ── 标注数据（needle 为 ASCII 近似，含智能引号/破折号也能匹配）──
const ANNOTATIONS = {
  // ===== Text 1 =====
  '2023:A:0': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The weather in Texas may have cooled' },
      { role: 'coordinate', label: '并列结构', needle: 'but the temperature will be high at the State Board of Education meeting in Austin this month' },
      { role: 'adv', label: '状语从句', needle: 'since the recent extreme heat' },
      { role: 'adv', label: '状语从句', needle: 'as officials debate how climate change is taught in Texas schools' },
      { role: 'noun', label: '名词性从句', needle: 'how climate change is taught in Texas schools' },
    ],
    main: { subject: 'The weather in Texas', predicate: 'may have cooled' },
  },
  '2023:A:1': {
    clauses: [{ role: 'adj', label: '定语从句', needle: 'who sympathises with views of the energy sector' }],
    main: { subject: 'Pat Hardy', predicate: 'is resisting', object: 'proposed changes to science standards for pre-teen pupils' },
  },
  '2023:A:2': {
    clauses: [{ role: 'coordinate', label: '并列结构', needle: 'and encourage discussion of mitigation measures' }],
    main: { subject: 'These', predicate: 'could emphasise', object: 'the primacy of human activity in recent climate change' },
  },
  '2023:A:3': {
    clauses: [{ role: 'main', label: '主句', needle: "Most scientists and experts sharply dispute Hardy's views" }],
    main: { subject: 'Most scientists and experts', predicate: 'dispute', object: 'Hardy views' },
  },
  '2023:A:4': {
    clauses: [
      { role: 'main', label: '主句', needle: 'They casually dismiss the career work of scholars and scientists as just another misguided opinion' },
      { role: 'appositive', label: '同位语', needle: 'senior communications strategist at the Texas Freedom Network' },
      { role: 'appositive', label: '同位语', needle: 'a non-profit group that monitors public education' },
      { role: 'adj', label: '定语从句', needle: 'that monitors public education' },
    ],
    main: { subject: 'They', predicate: 'casually dismiss', object: 'the career work of scholars and scientists' },
  },
  '2023:A:5': {
    clauses: [
      { role: 'noun', label: '名词性从句', needle: 'What millions of Texas kids learn in their public schools' },
      { role: 'prep', label: '介词短语', needle: 'by the political ideology of partisan board members' },
      { role: 'coordinate', label: '并列结构', needle: 'rather than facts and sound scholarship' },
    ],
    main: { subject: 'What millions of Texas kids learn in their public schools', predicate: 'is determined' },
  },
  '2023:A:6': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Such debates reflect fierce discussions across the US and around the world' },
      { role: 'adv', label: '状语从句', needle: 'as researchers, policymakers, teachers and students step up demands' },
      { role: 'prep', label: '介词短语', needle: 'for a greater focus on teaching about the facts of climate change in schools' },
    ],
    main: { subject: 'Such debates', predicate: 'reflect', object: 'fierce discussions across the US and around the world' },
  },
  '2023:A:7': {
    clauses: [
      { role: 'appositive', label: '同位语', needle: 'a non-profit group of scientists and teachers' },
      { role: 'participle', label: '分词短语', needle: 'looking at how state public schools across the country address climate change in science classes' },
      { role: 'noun', label: '名词性从句', needle: 'how state public schools across the country address climate change in science classes' },
    ],
    main: { subject: 'A study last year by the National Center for Science Education', predicate: 'gave', object: 'barely half of US states a grade B+ or higher' },
  },
  '2023:A:8': {
    clauses: [
      { role: 'prep', label: '介词短语', needle: 'Among the 10 worst performers' },
      { role: 'main', label: '主句', needle: 'were some of the most populous states' },
      { role: 'participle', label: '分词短语', needle: 'including Texas' },
      { role: 'adj', label: '定语从句', needle: 'which was given the lowest grade (F) and has a disproportionate influence' },
      { role: 'adv', label: '状语从句', needle: 'because its textbooks are widely sold elsewhere' },
    ],
    main: { subject: 'some of the most populous states', predicate: 'were' },
  },
  '2023:A:9': {
    clauses: [
      { role: 'appositive', label: '同位语', needle: "the centre's deputy director" },
      { role: 'noun', label: '名词性从句', needle: 'that setting state-level science standards is only one limited benchmark in a country' },
      { role: 'adj', label: '定语从句', needle: 'that decentralises decisions to local school boards' },
    ],
    main: { subject: 'Glenn Branch', predicate: 'cautions', object: 'that setting state-level science standards is only one limited benchmark' },
  },
  '2023:A:10': {
    clauses: [
      { role: 'adv', label: '状语从句', needle: 'Even if a state is considered a high performer in its science standards' },
      { role: 'main', label: '主句', needle: 'that does not mean it will be taught' },
      { role: 'noun', label: '名词性从句', needle: 'it will be taught' },
    ],
    main: { subject: 'that', predicate: 'does not mean', object: 'it will be taught' },
  },
  '2023:A:11': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Another issue is that' },
      { role: 'noun', label: '名词性从句', needle: 'while climate change is well integrated into some subjects and at some ages' },
      { role: 'adv', label: '状语从句', needle: 'while climate change is well integrated into some subjects and at some ages' },
      { role: 'appositive', label: '同位语', needle: 'such as earth and space sciences in high schools' },
      { role: 'prep', label: '介词短语', needle: 'for younger children' },
      { role: 'adj', label: '定语从句', needle: 'that are more widely taught' },
      { role: 'appositive', label: '同位语', needle: 'such as biology and chemistry' },
    ],
    main: { subject: 'Another issue', predicate: 'is' },
  },
  '2023:A:12': {
    clauses: [{ role: 'main', label: '主句', needle: 'It is also less prominent in many social studies courses' }],
    main: { subject: 'It', predicate: 'is', object: 'less prominent in many social studies courses' },
  },
  '2023:A:13': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Branch points out that' },
      { role: 'adv', label: '状语从句', needle: 'even if a growing number of official guidelines and textbooks reflect scientific consensus on climate change' },
      { role: 'adj', label: '定语从句', needle: 'that convey more slanted perspectives' },
    ],
    main: { subject: 'Branch', predicate: 'points out', object: 'that unofficial educational materials ... are being distributed to teachers' },
  },
  '2023:A:14': {
    clauses: [
      { role: 'main', label: '主句', needle: 'They include materials' },
      { role: 'participle', label: '分词短语', needle: 'sponsored by libertarian think-tanks and energy industry associations' },
    ],
    main: { subject: 'They', predicate: 'include', object: 'materials sponsored by libertarian think-tanks and energy industry associations' },
  },

  // ===== Text 2 =====
  '2023:B:0': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Communities throughout New England have been attempting to regulate short-term rentals' },
      { role: 'infinitive', label: '不定式', needle: 'to regulate short-term rentals' },
      { role: 'adv', label: '状语从句', needle: 'since sites like Airbnb took off in the 2010s' },
    ],
    main: { subject: 'Communities throughout New England', predicate: 'have been attempting', object: 'to regulate short-term rentals' },
  },
  '2023:B:1': {
    clauses: [
      { role: 'main', label: '主句', needle: "there's an increased urgency in such regulation" },
      { role: 'prep', label: '介词短语', needle: 'with record-high home prices and historically low inventory' },
      { role: 'prep', label: '介词短语', needle: 'particularly among those who worry' },
      { role: 'adj', label: '定语从句', needle: 'who worry that developers will come in and buy up swaths of housing' },
      { role: 'noun', label: '名词性从句', needle: 'that developers will come in and buy up swaths of housing' },
      { role: 'infinitive', label: '不定式', needle: 'to flip for a fortune on the short-term rental market' },
    ],
    main: { subject: 'there', predicate: 'is', object: 'an increased urgency in such regulation' },
  },
  '2023:B:2': {
    clauses: [
      { role: 'prep', label: '介词短语', needle: 'In New Hampshire' },
      { role: 'adj', label: '定语从句', needle: 'where the rental vacancy rate has dropped below 1 percent' },
      { role: 'main', label: '主句', needle: 'housing advocates fear' },
      { role: 'noun', label: '名词性从句', needle: 'unchecked short-term rentals will put further pressure on an already strained market' },
    ],
    main: { subject: 'housing advocates', predicate: 'fear', object: 'unchecked short-term rentals will put further pressure' },
  },
  '2023:B:3': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The state Legislature recently voted against a bill' },
      { role: 'adj', label: '定语从句', needle: "that would've made it illegal for towns to create legislation restricting short-term rentals" },
      { role: 'infinitive', label: '不定式', needle: 'to create legislation restricting short-term rentals' },
      { role: 'participle', label: '分词短语', needle: 'restricting short-term rentals' },
    ],
    main: { subject: 'The state Legislature', predicate: 'voted against', object: 'a bill' },
  },
  '2023:B:4': {
    clauses: [
      { role: 'main', label: '主句', needle: 'We are at a crisis level on the supply of rental housing' },
      { role: 'appositive', label: '同位语', needle: 'executive director of the Workforce Housing Coalition of the Greater Seacoast' },
    ],
    main: { subject: 'We', predicate: 'are', object: 'at a crisis level on the supply of rental housing' },
  },
  '2023:B:5': {
    clauses: [
      { role: 'prep', label: '介词短语', needle: 'Without enough affordable housing in southern New Hampshire towns' },
      { role: 'main', label: '主句', needle: 'employers are having a hard time finding a place to live' },
      { role: 'participle', label: '分词短语', needle: 'finding a place to live' },
      { role: 'infinitive', label: '不定式', needle: 'to live' },
    ],
    main: { subject: 'employers', predicate: 'are having', object: 'a hard time finding a place to live' },
  },
  '2023:B:6': {
    clauses: [
      { role: 'main', label: '主句', needle: 'short-term rentals also provide housing for tourists' },
      { role: 'prep', label: '介词短语', needle: 'for tourists' },
      { role: 'appositive', label: '同位语', needle: 'CEO of a local Association of Realtors' },
    ],
    main: { subject: 'short-term rentals', predicate: 'provide', object: 'housing for tourists' },
  },
  '2023:B:7': {
    clauses: [
      { role: 'main', label: '主句', needle: 'A lot of workers are servicing the tourist industry' },
      { role: 'coordinate', label: '并列结构', needle: 'and the tourism industry is serviced by those people coming in short term' },
      { role: 'participle', label: '分词短语', needle: 'coming in short term' },
      { role: 'coordinate', label: '并列结构', needle: "and so it's a cyclical effect" },
    ],
    main: { subject: 'A lot of workers', predicate: 'are servicing', object: 'the tourist industry' },
  },
  '2023:B:8': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Short-term rentals themselves are not the crux of the issue' },
      { role: 'appositive', label: '同位语', needle: 'an expert on affordable housing policy' },
    ],
    main: { subject: 'Short-term rentals themselves', predicate: 'are not', object: 'the crux of the issue' },
  },
  '2023:B:9': {
    clauses: [
      { role: 'main', label: '主句', needle: 'I think the question is' },
      { role: 'noun', label: '名词性从句', needle: "shouldn't a developer who's really building a hotel, but disguising it as not a hotel, be treated and taxed and regulated like a hotel" },
      { role: 'adj', label: '定语从句', needle: "who's really building a hotel" },
      { role: 'coordinate', label: '并列结构', needle: 'but disguising it as not a hotel' },
      { role: 'prep', label: '介词短语', needle: 'like a hotel' },
    ],
    main: { subject: 'I', predicate: 'think', object: 'the question is whether a developer should be treated like a hotel' },
  },
  '2023:B:10': {
    clauses: [
      { role: 'prep', label: '介词短语', needle: 'At the end of 2018' },
      { role: 'main', label: '主句', needle: 'Governor Charlie Baker of Massachusetts signed a bill' },
      { role: 'infinitive', label: '不定式', needle: 'to rein in those potential investor-buyers' },
    ],
    main: { subject: 'Governor Charlie Baker of Massachusetts', predicate: 'signed', object: 'a bill' },
  },
  '2023:B:11': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The bill requires every rental host' },
      { role: 'infinitive', label: '不定式', needle: 'to register with the state' },
      { role: 'noun', label: '名词性从句', needle: 'they carry insurance' },
      { role: 'coordinate', label: '并列结构', needle: 'and opens the potential for local taxes on top of a new state levy' },
    ],
    main: { subject: 'The bill', predicate: 'requires', object: 'every rental host to register with the state' },
  },
  '2023:B:12': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Boston took things even further' },
      { role: 'participle', label: '分词短语', needle: "requiring renters to register with the city's Inspectional Services Department" },
      { role: 'infinitive', label: '不定式', needle: "to register with the city's Inspectional Services Department" },
    ],
    main: { subject: 'Boston', predicate: 'took', object: 'things even further' },
  },
  '2023:B:13': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Horn said' },
      { role: 'noun', label: '名词性从句', needle: 'similar registration requirements could benefit struggling cities and towns' },
      { role: 'coordinate', label: '并列结构', needle: 'but If we want to make a change in the housing market' },
      { role: 'adv', label: '状语从句', needle: 'If we want to make a change in the housing market' },
      { role: 'noun', label: '名词性从句', needle: 'the main one is we have to build a lot more' },
    ],
    main: { subject: 'Horn', predicate: 'said', object: 'similar registration requirements could help but building more is the key' },
  },

  // ===== Text 3 =====
  '2023:C:0': {
    clauses: [
      { role: 'main', label: '主句', needle: 'you might have to be prepared to hunt around a bit' },
      { role: 'adv', label: '状语从句', needle: "If you're heading for your nearest branch of Waterstones" },
      { role: 'appositive', label: '同位语', needle: 'the biggest book retailer in the UK' },
      { role: 'prep', label: '介词短语', needle: "in search of the Duchess of Sussex's new children's book The Bench" },
      { role: 'coordinate', label: '并列结构', needle: "the same may be true of The President's Daughter" },
      { role: 'appositive', label: '同位语', needle: 'the new thriller by Bill Clinton and James Patterson' },
    ],
    main: { subject: 'you', predicate: 'might have to be prepared to hunt', object: 'around a bit' },
  },
  '2023:C:1': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Both of these books are published next week by Penguin Random House' },
      { role: 'appositive', label: '同位语', needle: 'a company currently involved in a stand-off with Waterstones' },
      { role: 'participle', label: '分词短语', needle: 'involved in a stand-off with Waterstones' },
      { role: 'prep', label: '介词短语', needle: 'with Waterstones' },
    ],
    main: { subject: 'Both of these books', predicate: 'are published' },
  },
  '2023:C:2': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The problem began late last year' },
      { role: 'adv', label: '状语从句', needle: 'when Penguin Random House confirmed' },
      { role: 'noun', label: '名词性从句', needle: 'that it had introduced a credit limit with Waterstones' },
      { role: 'prep', label: '介词短语', needle: 'at a very significant level' },
    ],
    main: { subject: 'The problem', predicate: 'began' },
  },
  '2023:C:3': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The trade magazine The Bookseller reported that' },
      { role: 'noun', label: '名词性从句', needle: 'that Waterstones branch managers were being told to remove PRH books from prominent areas' },
      { role: 'infinitive', label: '不定式', needle: 'to remove PRH books from prominent areas' },
      { role: 'prep', label: '介词短语', needle: 'from prominent areas such as tables, display spaces and windows' },
      { role: 'coordinate', label: '并列结构', needle: 'and were quietly retiring them to their relevant sections' },
    ],
    main: { subject: 'The trade magazine The Bookseller', predicate: 'reported', object: 'that branch managers were told to move PRH books' },
  },
  '2023:C:4': {
    clauses: [
      { role: 'main', label: '主句', needle: 'PRH declined to comment on the issue' },
      { role: 'infinitive', label: '不定式', needle: 'to comment on the issue' },
      { role: 'coordinate', label: '并列结构', needle: 'but a spokesperson for Waterstones told me' },
      { role: 'appositive', label: '同位语', needle: 'the only publisher in the UK to place any limitations on our ability to trade' },
      { role: 'infinitive', label: '不定式', needle: 'to place any limitations on our ability to trade' },
    ],
    main: { subject: 'PRH', predicate: 'declined', object: 'to comment on the issue' },
  },
  '2023:C:5': {
    clauses: [
      { role: 'main', label: '主句', needle: 'We are not boycotting PRH titles' },
      { role: 'coordinate', label: '并列结构', needle: 'but we are doing our utmost to ensure that availability for customers remains good' },
      { role: 'infinitive', label: '不定式', needle: 'to ensure that availability for customers remains good' },
      { role: 'noun', label: '名词性从句', needle: 'that availability for customers remains good' },
      { role: 'prep', label: '介词短语', needle: 'despite the lower overall levels of stock' },
    ],
    main: { subject: 'We', predicate: 'are not boycotting', object: 'PRH titles' },
  },
  '2023:C:6': {
    clauses: [
      { role: 'main', label: '主句', needle: 'We are hopeful' },
      { role: 'prep', label: '介词短语', needle: 'with our shops now open again' },
      { role: 'noun', label: '名词性从句', needle: 'that normality will return' },
      { role: 'coordinate', label: '并列结构', needle: 'and that we will be allowed to buy appropriately' },
      { role: 'infinitive', label: '不定式', needle: 'to buy appropriately' },
    ],
    main: { subject: 'We', predicate: 'are', object: 'hopeful' },
  },
  '2023:C:7': {
    clauses: [
      { role: 'main', label: '主句', needle: 'our shops are exceptionally busy' },
      { role: 'coordinate', label: '并列结构', needle: 'and book sales are very strong' },
    ],
    main: { subject: 'our shops', predicate: 'are', object: 'exceptionally busy' },
  },
  '2023:C:8': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The sales for our May Books of the Month surpassed any month since 2018' },
      { role: 'prep', label: '介词短语', needle: 'for our May Books of the Month' },
      { role: 'prep', label: '介词短语', needle: 'since 2018' },
    ],
    main: { subject: 'The sales for our May Books of the Month', predicate: 'surpassed', object: 'any month' },
  },
  '2023:C:9': {
    clauses: [
      { role: 'main', label: '主句', needle: 'PRH authors have been the losers' },
      { role: 'prep', label: '介词短语', needle: 'In the meantime' },
    ],
    main: { subject: 'PRH authors', predicate: 'have been', object: 'the losers' },
  },
  '2023:C:10': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Big-name PRH authors may suffer a bit' },
      { role: 'coordinate', label: '并列结构', needle: "but it's those mid-list authors" },
      { role: 'adj', label: '定语从句', needle: "who normally rely on Waterstones staff's passion" },
      { role: 'adj', label: '定语从句', needle: 'who will be praying for an end to the dispute' },
      { role: 'prep', label: '介词短语', needle: 'for promoting books by lesser-known writers' },
    ],
    main: { subject: 'Big-name PRH authors', predicate: 'may suffer', object: 'a bit' },
  },
  '2023:C:11': {
    clauses: [
      { role: 'main', label: '主句', needle: 'It comes at a time' },
      { role: 'adv', label: '状语从句', needle: 'when authors are already worried' },
      { role: 'prep', label: '介词短语', needle: 'about the consequences of the proposed merger between PRH and another big publisher' },
      { role: 'appositive', label: '同位语', needle: 'Simon & Schuster' },
      { role: 'coordinate', label: '并列结构', needle: 'the reduction in the number of unaligned UK publishers is likely to lead to fewer bidding wars' },
      { role: 'noun', label: '名词性从句', needle: 'what is published' },
    ],
    main: { subject: 'It', predicate: 'comes', object: 'at a time' },
  },
  '2023:C:12': {
    clauses: [
      { role: 'main', label: '主句', needle: 'This is all part of a wider change towards concentration of power and cartels' },
      { role: 'prep', label: '介词短语', needle: 'towards concentration of power and cartels' },
    ],
    main: { subject: 'This', predicate: 'is', object: 'all part of a wider change' },
  },
  '2023:C:13': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Literary agencies are getting bigger' },
      { role: 'infinitive', label: '不定式', needle: 'to have the clout to negotiate better terms with publishers' },
      { role: 'infinitive', label: '不定式', needle: 'to negotiate better terms with publishers' },
      { role: 'coordinate', label: '并列结构', needle: 'publishers consolidating to deal with Amazon' },
      { role: 'participle', label: '分词短语', needle: 'consolidating to deal with Amazon' },
    ],
    main: { subject: 'Literary agencies', predicate: 'are getting', object: 'bigger' },
  },
  '2023:C:14': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The publishing industry talks about diversity in terms of authors and staff' },
      { role: 'coordinate', label: '并列结构', needle: 'but it also needs a plurality of ways' },
      { role: 'prep', label: '介词短语', needle: 'of delivering intellectual contact, choice and different voices' },
    ],
    main: { subject: 'The publishing industry', predicate: 'talks about', object: 'diversity' },
  },
  '2023:C:15': {
    clauses: [
      { role: 'main', label: '主句', needle: 'many of the most interesting books in recent years have come from small publishers' },
      { role: 'prep', label: '介词短语', needle: 'from small publishers' },
    ],
    main: { subject: 'many of the most interesting books in recent years', predicate: 'have come', object: 'from small publishers' },
  },
  '2023:C:16': {
    clauses: [
      { role: 'main', label: '主句', needle: 'We shall see' },
      { role: 'noun', label: '名词性从句', needle: 'whether that plurality is a casualty of the current need among publishers' },
      { role: 'infinitive', label: '不定式', needle: 'to be big enough to take on all-comers' },
      { role: 'infinitive', label: '不定式', needle: 'to take on all-comers' },
    ],
    main: { subject: 'We', predicate: 'shall see', object: 'whether that plurality survives' },
  },

  // ===== Text 4 =====
  '2023:D:0': {
    clauses: [{ role: 'main', label: '主句', needle: 'Scientific papers are the recordkeepers of progress in research' }],
    main: { subject: 'Scientific papers', predicate: 'are', object: 'the recordkeepers of progress in research' },
  },
  '2023:D:1': {
    clauses: [
      { role: 'main', label: '主句', needle: 'researchers publish millions of papers' },
      { role: 'prep', label: '介词短语', needle: 'in more than 30,000 journals' },
    ],
    main: { subject: 'researchers', predicate: 'publish', object: 'millions of papers' },
  },
  '2023:D:2': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The scientific community measures the quality of those papers in a number of ways' },
      { role: 'participle', label: '分词短语', needle: 'including the perceived quality of the journal' },
      { role: 'prep', label: '介词短语', needle: "as reflected by the title's impact factor" },
      { role: 'adj', label: '定语从句', needle: 'a specific paper accumulates' },
    ],
    main: { subject: 'The scientific community', predicate: 'measures', object: 'the quality of those papers' },
  },
  '2023:D:3': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The careers of scientists and the reputation of their institutions depend on the number and prestige of the papers' },
      { role: 'adj', label: '定语从句', needle: 'they produce' },
      { role: 'coordinate', label: '并列结构', needle: 'but even more so on the citations attracted by these papers' },
      { role: 'participle', label: '分词短语', needle: 'attracted by these papers' },
    ],
    main: { subject: 'The careers of scientists and the reputation of their institutions', predicate: 'depend on', object: 'the number and prestige of the papers' },
  },
  '2023:D:4': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Citation cartels, where journals, authors, and institutions conspire to inflate citation numbers, have existed for a long time.' },
      { role: 'adj', label: '定语从句', needle: 'where journals, authors, and institutions conspire to inflate citation numbers' },
      { role: 'infinitive', label: '不定式', needle: 'to inflate citation numbers' },
    ],
    main: { subject: 'Citation cartels', predicate: 'have existed' },
  },
  '2023:D:5': {
    clauses: [
      { role: 'prep', label: '介词短语', needle: 'In 2016' },
      { role: 'main', label: '主句', needle: 'researchers developed an algorithm' },
      { role: 'infinitive', label: '不定式', needle: 'to recognize suspicious citation patterns' },
      { role: 'participle', label: '分词短语', needle: 'including groups of authors' },
      { role: 'adj', label: '定语从句', needle: 'that disproportionately cite one another' },
      { role: 'adj', label: '定语从句', needle: 'that cite each other frequently' },
      { role: 'infinitive', label: '不定式', needle: 'to increase the impact factors of their publications' },
    ],
    main: { subject: 'researchers', predicate: 'developed', object: 'an algorithm' },
  },
  '2023:D:6': {
    clauses: [
      { role: 'main', label: '主句', needle: 'another expression of this predatory behavior has emerged' },
      { role: 'other', label: '其他成分', needle: 'so-called support service consultancies' },
      { role: 'adj', label: '定语从句', needle: 'that provide language and other editorial support to individual authors and to journals' },
      { role: 'infinitive', label: '不定式', needle: 'to add a number of citations to their articles' },
    ],
    main: { subject: 'another expression of this predatory behavior', predicate: 'has emerged' },
  },
  '2023:D:7': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The advent of electronic publishing and authors need to find outlets for their papers resulted in thousands of new journals' },
      { role: 'infinitive', label: '不定式', needle: 'to find outlets for their papers' },
    ],
    main: { subject: 'The advent of electronic publishing and authors need', predicate: 'resulted in', object: 'thousands of new journals' },
  },
  '2023:D:8': {
    clauses: [{ role: 'main', label: '主句', needle: "The birth of predatory journals wasn't far behind." }],
    main: { subject: 'The birth of predatory journals', predicate: 'was not', object: 'far behind' },
  },
  '2023:D:9': {
    clauses: [
      { role: 'main', label: '主句', needle: 'These journals can act as milk cows' },
      { role: 'adj', label: '定语从句', needle: 'where every single article in an issue may cite a specific paper or a series of papers' },
    ],
    main: { subject: 'These journals', predicate: 'can act', object: 'as milk cows' },
  },
  '2023:D:10': {
    clauses: [
      { role: 'prep', label: '介词短语', needle: 'In some instances' },
      { role: 'main', label: '主句', needle: 'there is absolutely no relationship' },
      { role: 'prep', label: '介词短语', needle: 'between the content of the article and the citations' },
    ],
    main: { subject: 'there', predicate: 'is', object: 'absolutely no relationship' },
  },
  '2023:D:11': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The peculiar part is that' },
      { role: 'noun', label: '名词性从句', needle: 'that the journal that the editor is supposedly working for is not profiting at all' },
      { role: 'adj', label: '定语从句', needle: 'that the editor is supposedly working for' },
      { role: 'coordinate', label: '并列结构', needle: 'it is just providing citations to other journals' },
    ],
    main: { subject: 'The peculiar part', predicate: 'is', object: 'that the journal is not profiting' },
  },
  '2023:D:12': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Such practices can lead an article' },
      { role: 'infinitive', label: '不定式', needle: 'to accrue more than 150 citations in the same year' },
      { role: 'adj', label: '定语从句', needle: 'that it was published' },
    ],
    main: { subject: 'Such practices', predicate: 'can lead', object: 'an article to accrue more than 150 citations' },
  },
  '2023:D:13': {
    clauses: [{ role: 'main', label: '主句', needle: 'How insidious is this type of citation manipulation' }],
    main: { subject: 'this type of citation manipulation', predicate: 'is', object: 'insidious' },
  },
  '2023:D:14': {
    clauses: [
      { role: 'prep', label: '介词短语', needle: 'In one example' },
      { role: 'main', label: '主句', needle: 'was able to use at least 15 journals as citation providers' },
      { role: 'appositive', label: '同位语', needle: 'acting as author, editor, and consultant' },
      { role: 'participle', label: '分词短语', needle: 'published by five scientists at three universities' },
      { role: 'prep', label: '介词短语', needle: 'at three universities' },
    ],
    main: { subject: 'an individual', predicate: 'was able to use', object: 'at least 15 journals as citation providers' },
  },
  '2023:D:15': {
    clauses: [
      { role: 'main', label: '主句', needle: 'The problem is rampant in Scopus' },
      { role: 'appositive', label: '同位语', needle: 'a citation database' },
      { role: 'adj', label: '定语从句', needle: 'which includes a high number of the new international journals' },
    ],
    main: { subject: 'The problem', predicate: 'is', object: 'rampant in Scopus' },
  },
  '2023:D:16': {
    clauses: [
      { role: 'main', label: '主句', needle: 'a listing in Scopus seems to be a criterion' },
      { role: 'infinitive', label: '不定式', needle: 'to be targeted in this type of citation manipulation' },
    ],
    main: { subject: 'a listing in Scopus', predicate: 'seems', object: 'to be a criterion' },
  },
  '2023:D:17': {
    clauses: [
      { role: 'main', label: '主句', needle: 'Scopus itself has all the data necessary' },
      { role: 'infinitive', label: '不定式', needle: 'to detect this malpractice' },
    ],
    main: { subject: 'Scopus itself', predicate: 'has', object: 'all the data necessary' },
  },
  '2023:D:18': {
    clauses: [{ role: 'main', label: '主句', needle: 'Red flags include a large number of citations to an article within the first year' }],
    main: { subject: 'Red flags', predicate: 'include', object: 'a large number of citations' },
  },
  '2023:D:19': {
    clauses: [
      { role: 'prep', label: '介词短语', needle: 'for authors who wish to steer clear of citation cartel activities' },
      { role: 'adj', label: '定语从句', needle: 'who wish to steer clear of citation cartel activities' },
      { role: 'infinitive', label: '不定式', needle: 'to steer clear of citation cartel activities' },
      { role: 'adv', label: '状语从句', needle: 'when an editor, a reviewer, or a support service asks you to add inappropriate references' },
      { role: 'infinitive', label: '不定式', needle: 'to add inappropriate references' },
      { role: 'main', label: '主句', needle: 'do not oblige and do report the request to the journal' },
      { role: 'coordinate', label: '并列结构', needle: 'and do report the request to the journal' },
    ],
    main: { subject: 'you（祈使省略）', predicate: 'do not oblige', object: 'and report the request to the journal' },
  },
};

// 归一化：去非字母数字（大小写不敏感）
function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// 在原文中定位 needle（宽容匹配），返回精确原文切片
function extract(sentence, needle) {
  const n = norm(needle);
  if (!n) return null;
  const sn = norm(sentence);
  const at = sn.indexOf(n);
  if (at < 0) return null;
  // 映射回原始下标
  let s = 0;
  let c = 0;
  while (c < at) {
    if (/[a-z0-9]/i.test(sentence[s])) c++;
    s++;
  }
  const start = s;
  c = 0;
  while (c < n.length) {
    if (/[a-z0-9]/i.test(sentence[s])) c++;
    s++;
  }
  return { start, end: s, text: sentence.slice(start, s) };
}

// 读入 2023 句子，生成结构
function build() {
  const sentences = [];
  for (const f of readdirSync(READING_ROOT).filter((x) => /\.json$/i.test(x)).sort()) {
    const d = JSON.parse(readFileSync(resolve(READING_ROOT, f), 'utf8'));
    for (const s of d.sentences) sentences.push({ key: `2023:${d.code}:${s.seq}`, en: s.en });
  }
  const out = {};
  const missing = [];
  for (const { key, en } of sentences) {
    const a = ANNOTATIONS[key];
    if (!a) {
      missing.push(`${key}: 无标注`);
      continue;
    }
    const clauses = [];
    for (const cl of a.clauses) {
      const hit = extract(en, cl.needle);
      if (!hit) {
        missing.push(`${key} [${cl.label}] needle 未命中: "${cl.needle.slice(0, 50)}"`);
        continue;
      }
      clauses.push({ role: cl.role, label: cl.label, text: hit.text.trim() });
    }
    out[key] = { clauses, main: a.main };
  }
  return { out, missing };
}

const { out, missing } = build();
if (missing.length) {
  console.log(`未命中 ${missing.length} 处：`);
  for (const m of missing) console.log('  -', m);
  process.exitCode = 1;
} else {
  writeFileSync('db/data/reading/structures.json', JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`已生成 structures.json：${Object.keys(out)} 条`);
}
