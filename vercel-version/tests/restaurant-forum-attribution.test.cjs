/**
 * 兵长茶会（RestaurantForum）发布弹窗优化回归测试。
 *
 * 两件事被钉住，免得以后改动把它们复辟回去：
 *   1) 发帖署名（属名）默认取「账号昵称」，而不是默认 PRESET_CHARACTERS[0].name（利威尔）。
 *      早期实现里 mount 副作用只在 composeCategory !== 'roleplay' 时才把账号昵称写进 nickname，
 *      而默认分类偏偏就是 roleplay，于是闲聊/接龙/市集的署名永远停在「利威尔」。
 *      另外选角动作不再改写 nickname，避免拟音人物名被带进署名。
 *   2) 自己发的卡片（post.uid === currentUid）必须出现删除按键。
 *      之前只有「故事接龙」卡片有，角色拟音 / 闲聊茶歇卡片缺。现在三类卡片都要有。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'components', 'RestaurantForum.tsx');
const src = fs.readFileSync(SRC, 'utf8');

test('发帖署名默认取账号昵称（不再被拟音人物名顶替）', () => {
  // 新行为：mount 副作用只要 profile.nickname 存在就写入 nickname，不再卡 composeCategory
  assert.match(
    src,
    /if \(profile\.nickname\) \{\s*setNickname\(profile\.nickname\);/s,
    'mount 副作用必须把账号昵称写进 nickname',
  );
  // 旧的有害写法必须消失：账号昵称被 composeCategory 守卫挡住
  assert.equal(
    /profile\.nickname && composeCategory !== 'roleplay'/.test(src),
    false,
    '不得再用 composeCategory !== \'roleplay\' 守卫账号昵称，否则默认分类 roleplay 下署名永远是利威尔',
  );
  // nickname 初始值改为空串（由账号档案填充），不再默认 PRESET 人物名
  assert.match(src, /const \[nickname, setNickname\] = useState\(''\)/, 'nickname 初始值应留空，待账号档案填充');
  // 选角动作不得再改写 nickname（避免拟音人物名带进署名）
  assert.equal(
    /setSelectedChar\(char\);\s*setNickname\(char\.name\)/.test(src),
    false,
    'handleSelectCharacter 不得改写 nickname',
  );
  // 署名输入框占位符提示默认账号昵称
  assert.match(src, /placeholder="账号昵称（默认）"/, '发帖署名占位符应提示「账号昵称（默认）」');
});

test('三类卡片都给「自己发的帖」显示删除按键', () => {
  // 角色拟音 / 闲聊茶歇 / 故事接龙 三处都要用 currentUid && post.uid === currentUid 守卫删除键
  const guards = src.match(/currentUid && post\.uid === currentUid/g) || [];
  assert.equal(guards.length, 3, `应有 3 处删除键守卫（角色拟音/闲聊茶歇/故事接龙），实际 ${guards.length} 处`);
  // 删除键必须调用已存在的 handleDeletePost
  assert.match(src, /void handleDeletePost\(post\.id\)/, '删除键必须调用 handleDeletePost');
});
