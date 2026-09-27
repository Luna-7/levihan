import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { cosService } from '../services/cosClient';
import type { GoodsItem } from '../types';
import type { DoujinBookItem, GroupNovel } from '../types/doujinArchive';
import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from '../utils/cloudbaseEndpoint';
import { soundManager } from '../utils/audio';
import { useAppShellStore } from '../stores/appShellStore';
import { CardPatternOverlay } from './CardPatternOverlay';

type BiteItem = {
  id: string;
  kind: 'trivia' | 'recommend' | 'novel' | 'anthology' | 'illustration';
  label: string;
  title: string;
  detail: string;
  source: string;
  externalUrl?: string;
  targetId?: string;
};

const WIKI_URL = 'https://shipping.fandom.com/wiki/LeviHan';
const TRIVIA: string[] = [
  '韩吉对利威尔说的第一句话（在外传《无悔的选择》中）是：“我在关键时刻看着你！”韩吉在第132话牺牲自己后，利威尔对韩吉最后的想法是：“继续看着我们吧。”',
  '利威尔和韩吉对彼此有着非常深刻的理解和熟悉，以至于他们似乎不需要真正说出话就能彼此交流。',
  '韩吉的右眼和利威尔的左眼都受到了损伤，两处伤都是由爆炸造成的。',
  '利威尔是个洁癖，而韩吉并不坚持洗澡。',
  '韩吉死后，利威尔说：“回头见，韩吉。”同样身为阿克曼的三笠，在梦境与现实交叠之际也说过相同的话。',
  '在《伊尔泽的笔记 OVA》中，韩吉因埃尔文不允许捕捉巨人而焦躁，并在奥路欧模仿利威尔时抓住了他。',
  '在《进击！巨人中学校》漫画第1卷第22话中，利威尔拒绝佩特拉的马戏团邀请，因为他已经先和韩吉去过了。',
  '莫布里特将利威尔与韩吉的关系形容为“一种因共同度过许多年而形成的特殊羁绊”。',
  '在官方《进击！巨人中学校》第47话中，韩吉意外撕破和服后，是利威尔亲自将和服缝好的。',
  '在《进击！巨人中学校》漫画中，利威尔和韩吉从小就是非常亲密的朋友和邻居。',
  '韩吉的角色访谈暗示，利威尔会把韩吉打晕并强行给韩吉洗澡。',
  '在《进击！巨人中学校》第30话和第43话中，利威尔亲自为韩吉烤饼干并做煎蛋卷。',
  'Jessica Calvello（韩吉英语配音演员）公开支持 LeviHan，并发布过多条相关内容。',
  'Matthew Mercer 与 Jessica Calvello 曾在漫展现场朗读 LeviHan 同人小说。',
  '谏山创曾画过利威尔与韩吉并肩站立的小涂鸦，上方写着他们的日文配对名“RivaHan”。',
  '2021年，LeviHan 与 EreMika 一样，拥有粉丝举办的专属同人志活动。',
  'Matthew Mercer 曾以利威尔身份写道：“韩吉有不错的书……而且泡的茶……我猜还可以。”Jessica Calvello 回应：“我爱那个小矮子。”',
  '讲谈社为最终话倒计时发布的御神签，将利威尔与韩吉的关系解释为可能具有浪漫性质。',
  '在许多同时描绘利威尔与韩吉的官方画作中，经常能看到利威尔望向韩吉所在的方向。',
  '《别册少年 Magazine》在第132话彩色版宣传中暗示，韩吉牺牲前利威尔想说“不要走”。',
  '最终季第25集导演绘制的片尾卡中，韩吉在利威尔醒来后将炖菜递给了他。',
  '拉丁美洲西班牙语版《无悔的选择》中，韩吉第一次看到利威尔行动时称他“很性感”，并且脸红了。',
  '梅赛德斯－奔驰与《进击的巨人》合作时，单独展示了韩吉对利威尔说“我宁愿我们两个人就住在这里”的第126话分镜。',
  'Smartpass AU《布满灰尘的图书馆》中，利威尔告诉韩吉她的生命很重要，并在书堆砸下时救了她。',
  '韩吉的巨人死后，利威尔半夜为她准备茶；他也曾把珍爱的黑罐茶送给韩吉。',
  '《AOT TACTICS》中，韩吉说与自己最亲近的人是利威尔，两人把彼此视为最好的朋友。',
  'Smartpass AU《Shelter from the Rain》中，利威尔拜托莫布里特照顾韩吉，因为他无法一直陪在她身边。',
  '最终展览的里布斯商会曾表示，利威尔为韩吉团长订购／制作了一款拥有强力清洁能力的头发护理剂。',
  '《AOT TACTICS》中，利威尔想起韩吉一直嚷着想吃甜食，于是在情人节亲自为她制作巧克力。',
  'Smartpass《My First Time Around》中，商贩问利威尔“家人”时，第一个出现在他脑海中的是韩吉团长。',
];

const pick = <T,>(items: T[]): T | undefined => items.length ? items[Math.floor(Math.random() * items.length)] : undefined;

export const RandomLeviHanBite: React.FC<{
  onNavigateTab: (tab: string) => void;
  onShowToast: (msg: string) => void;
  onPairChange?: (secondCharacterUrl: string) => void;
}> = ({ onNavigateTab, onShowToast, onPairChange }) => {
  const [goods, setGoods] = useState<GoodsItem[]>([]);
  const [pool, setPool] = useState<BiteItem[]>(() => TRIVIA.map((detail, index) => ({ id:`trivia-${index}`, kind:'trivia', label:'琐事', title:'LeviHan 琐事', detail, source:'LeviHan Wiki · Trivia（外链）', externalUrl:WIKI_URL })));
  const [pairStart, setPairStart] = useState(0);
  const [selected, setSelected] = useState<BiteItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      cosService.loadGoodsList(), cosService.loadNovelList(), cosService.loadArchiveData(),
      fetchBackend(ADMIN_UPLOAD_ENDPOINT, { method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body:JSON.stringify({action:'forumList'}) }).then((r) => r.json()),
    ]).then((results) => {
      if (cancelled) return;
      const next: BiteItem[] = TRIVIA.map((detail, index) => ({ id:`trivia-${index}`, kind:'trivia', label:'琐事', title:'LeviHan 琐事', detail, source:'LeviHan Wiki · Trivia（外链）', externalUrl:WIKI_URL }));
      if (results[0].status === 'fulfilled') {
        const loadedGoods = results[0].value;
        setGoods(loadedGoods);
        // 每次页面重新加载时，从 12、34、56…这类相邻偶数配对中随机抽取一组。
        const pairCount = Math.max(1, Math.floor(loadedGoods.length / 2));
        setPairStart(Math.floor(Math.random() * pairCount) * 2);
      }
      if (results[1].status === 'fulfilled') (results[1].value as GroupNovel[]).forEach((novel) => next.push({ id:`novel-${novel.id}`, kind:novel.isRelayCompiled?'anthology':'novel', label:novel.isRelayCompiled?'合订本':'小说', title:novel.title, detail:novel.authorNote || `${novel.author} · ${novel.chars || 0} 字`, source:`站内${novel.isRelayCompiled?'接龙合订本':'小说'} · ${novel.author}`, targetId:novel.id }));
      if (results[2].status === 'fulfilled') (results[2].value as DoujinBookItem[]).filter((book) => (book.category || '') === '插画集').forEach((book) => next.push({ id:`art-${book.id}`, kind:'illustration', label:'插画', title:book.titleZh, detail:`${book.circle} · ${(book.tags || []).join(' · ') || '利韩插画集'}`, source:`站内插画集 · ${book.circle}`, targetId:book.id }));
      if (results[3].status === 'fulfilled') {
        const posts = Array.isArray(results[3].value?.posts) ? results[3].value.posts : [];
        posts.filter((post: any) => post?.category === 'links').forEach((post: any) => next.push({ id:`rec-${post.id}`, kind:'recommend', label:'安利墙', title:post.title || post.link?.ogTitle || '同好安利', detail:post.body || post.link?.ogDescription || '来自同好的站外作品推荐', source:`站内安利墙 · ${post.author || '同好'}`, targetId:post.id }));
      }
      setPool(next);
      setSelected(pick(next) || null);
    });
    return () => { cancelled = true; };
  }, []);

  const pair = useMemo(() => goods.length >= 2 ? [goods[pairStart % goods.length], goods[(pairStart + 1) % goods.length]] : goods.slice(0, 2), [goods, pairStart]);
  useEffect(() => {
    onPairChange?.(pair[1] ? cosService.getGoodsThumbUrl(pair[1].file, 240) : '');
  }, [onPairChange, pair]);
  const reroll = useCallback(() => {
    soundManager.playBlip();
    const pairCount = Math.max(1, Math.floor(goods.length / 2));
    setPairStart(Math.floor(Math.random() * pairCount) * 2);
    setSelected(pick(pool) || null);
  }, [goods.length, pool]);

  useEffect(() => { if (!selected) setSelected(pick(pool) || null); }, [pool, selected]);

  const goToTarget = () => {
    if (!selected) return;
    soundManager.playPageTurn();
    if (selected.externalUrl) { window.open(selected.externalUrl, '_blank', 'noopener,noreferrer'); return; }
    if ((selected.kind === 'novel' || selected.kind === 'anthology') && selected.targetId) { useAppShellStore.getState().openNovel(selected.targetId); return; }
    if (selected.kind === 'illustration') { useAppShellStore.getState().openArchiveCategory('插画集'); onNavigateTab('resources'); return; }
    if (selected.kind === 'recommend') {
      const url = new URL(window.location.href); url.searchParams.set('category','links'); if (selected.targetId) url.searchParams.set('postId',selected.targetId); window.history.replaceState(null,'',url.toString()); onNavigateTab('doujinshi'); return;
    }
    onShowToast('这条琐事来自 LeviHan Wiki，将为你打开原始来源');
  };

  return <section className="home-quick-action-shell home-random-bite mx-2.5 sm:mx-4 lg:mx-6 mt-1.5">
    <button type="button" onClick={() => selected && setDetailOpen(true)} className="home-quick-card relative block h-full w-full overflow-hidden rounded-xl bg-[#FAF3E3]/95 pl-3 pr-16 shadow-[0_2px_7px_rgba(140,108,71,.18)] transition-transform hover:bg-[#FFF8E9] active:scale-[.99] cursor-pointer">
      <CardPatternOverlay opacity={0.07} mode="multiply" />
      {pair[0] && <img src={cosService.getGoodsThumbUrl(pair[0].file, 240)} alt={pair[0].title || '随机人物'} className="home-quick-character absolute right-1 object-contain object-bottom" loading="lazy" decoding="async" />}
      <span className="relative z-10 flex h-full min-w-0 flex-col items-start justify-center text-left">
        <span className="font-serif-title text-sm sm:text-base font-black text-[#1E4334]">🎲 嗑一口利韩</span>
        <span className="mt-0.5 flex items-center gap-1 text-[9px] text-[#8C6C47]">点击抽取今日份利韩 <b className="text-[10px]">›</b></span>
      </span>
    </button>
    {detailOpen && selected && createPortal(<div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onClick={() => setDetailOpen(false)}><div className="relative w-full max-w-md rounded-xl border-2 border-[#1E4334] bg-[#FFFDF6] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}><CardPatternOverlay opacity={0.08} mode="multiply"/><div className="relative z-10"><div className="flex items-start justify-between gap-3"><div><span className="rounded bg-[#8F3426] px-2 py-1 text-[9px] font-bold text-white">{selected.label}</span><h3 className="mt-2 font-serif-title text-lg font-black text-[#1E4334]">{selected.title}</h3></div><button onClick={() => setDetailOpen(false)} className="text-lg text-[#8C6C47] cursor-pointer">✕</button></div><p className="mt-3 whitespace-pre-wrap rounded-md bg-[#F7F1E5] p-3 text-sm leading-7 text-[#3E342B]">{selected.detail}</p><p className="mt-2 text-[10px] text-[#9A8268]">来源：{selected.source}</p><div className="mt-4 flex gap-2"><button onClick={goToTarget} className="flex-1 rounded-md border-2 border-[#B7791F] bg-[#E5A93C] px-3 py-2 text-sm font-bold text-[#3E2C16] cursor-pointer">{selected.externalUrl?'打开来源网站':'前往对应区域'}</button><button onClick={reroll} className="rounded-md border-2 border-[#1E4334] bg-[#FFF9EC] px-3 py-2 text-sm font-bold text-[#1E4334] cursor-pointer">换一条</button></div></div></div></div>,document.body)}
  </section>;
};
