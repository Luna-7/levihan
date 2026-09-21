/**
 * 兵长茶会（RestaurantForum）发布弹窗优化回归测试。
 *
 * 三件事被钉住，免得以后改动把它们复辟回去：
 *   1) 发帖署名默认取「账号昵称」，而不是默认 PRESET_CHARACTERS[0].name（利威尔）。
 *      早期实现里 mount 副作用只在 composeCategory !== 'roleplay' 时才把账号昵称写进 nickname，
 *      而默认分类偏偏就是 roleplay，于是闲聊/接龙/市集的署名永远停在「利威尔」。
 *      另外选角动作不再改写 nickname，避免拟音人物名被带进署名。
 *      （署名输入框已在 ad88b2a 整体移除、发布人固定账号昵称 —— 这里反向钉住，别又加回来。）
 *   2) 自己发的卡片（post.uid === currentUid）必须出现删除按键。
 *      之前只有「故事接龙」卡片有，角色拟音 / 闲聊茶歇卡片缺。现在四类卡片都要有
 *      （角色拟音 / 闲聊茶歇 / 故事接龙 / 安利墙）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'components', 'RestaurantForum.tsx');
const src = fs.readFileSync(SRC, 'utf8');

test('发帖署名默认取账号昵称（不再被拟音人物名顶替）', () => {
  // 账号档案直接来自唯一的 auth store，昵称应随登录或改名实时更新。
  assert.match(
    src,
    /const profile = useAuthStore\(\(state\) => state\.profile\);[\s\S]*?const nickname = profile\?\.nickname \|\| '';/,
    '发帖署名必须直接读取全局账号昵称',
  );
  // 旧的有害写法必须消失：账号昵称被 composeCategory 守卫挡住
  assert.equal(
    /profile\.nickname && composeCategory !== 'roleplay'/.test(src),
    false,
    '不得再用 composeCategory !== \'roleplay\' 守卫账号昵称，否则默认分类 roleplay 下署名永远是利威尔',
  );
  assert.equal(/setNickname\(/.test(src), false, '不得另存一份可能过期的昵称状态');
  // 选角动作不得再改写 nickname（避免拟音人物名带进署名）
  assert.equal(
    /setSelectedChar\(char\);\s*setNickname\(char\.name\)/.test(src),
    false,
    'handleSelectCharacter 不得改写 nickname',
  );
  // 署名输入框已移除：发布人固定账号昵称，不允许再加回手填署名
  assert.equal(
    /placeholder="账号昵称（默认）"/.test(src),
    false,
    '署名输入框已移除，不应再出现手填署名的占位符',
  );
  assert.match(src, /nickname\.trim\(\) \|\| '调查兵'/, '空昵称发布时应兜底为「调查兵」');
});

test('四类卡片都给「自己发的帖」显示删除按键', () => {
  // 角色拟音 / 闲聊茶歇 / 故事接龙 / 安利墙 四处都要用 currentUid && post.uid === currentUid 守卫删除键
  const guards = src.match(/currentUid && post\.uid === currentUid/g) || [];
  assert.equal(guards.length, 4, `应有 4 处删除键守卫（角色拟音/闲聊茶歇/故事接龙/安利墙），实际 ${guards.length} 处`);
  // 删除键必须调用已存在的 handleDeletePost
  assert.match(src, /void handleDeletePost\(post\.id\)/, '删除键必须调用 handleDeletePost');
});
