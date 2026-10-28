// 帮助页（help/help.html）的契约测试。
//
// 这一页不在扩展包里（scripts/make_zip.py 是显式文件清单），但它被发布到通道的
// <服务>/cloudfile-updates/help.html，是用户装机的第一步 —— 坏了就装不上。
//
// 2026-10-28 的事故就是这一页：脚本开头给 #agent-script 赋值，而那个元素在改版时已经
// 从页面里删掉了。getElementById 返回 null 抛 TypeError，整个 IIFE 当场中断，后面
// 「#install-cmd 的 href = <dir>/install.cmd」永远没执行 —— href 停在 "#"，再叠加
// download 属性，点「下载 install.cmd」实际下载的是 help.html 自己。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'help', 'help.html');
const html = fs.readFileSync(PAGE, 'utf8');

function scriptBlocks() {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
}

test('帮助页脚本引用的元素必须真的在页面里', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const used = new Set();
  for (const block of scriptBlocks()) {
    for (const match of block.matchAll(/getElementById\('([^']+)'\)/g)) used.add(match[1]);
    for (const match of block.matchAll(/setText\('([^']+)'/g)) used.add(match[1]);
  }
  assert.ok(used.size > 0, '脚本里应当至少引用一个元素');
  const missing = [...used].filter(id => !ids.has(id));
  assert.deepEqual(missing, [], `脚本引用了页面里不存在的元素：${missing.join(', ')}`);
});

test('install.cmd 的下载链接带显式文件名，且不会退化成 #', () => {
  const tag = html.match(/<a[^>]*id="install-cmd"[^>]*>/);
  assert.ok(tag, '找不到 #install-cmd 链接');
  // download 属性把「保存的文件名」钉死，脚本出错也不会存成 help.html。
  assert.match(tag[0], /download="install\.cmd"/, tag[0]);
  // href 由脚本改成 <dir>/install.cmd；静态兜底也必须是 install.cmd 而不是 #。
  assert.doesNotMatch(tag[0], /href="#"/, 'href 不能是 # —— 带 download 时会下载本页');
  assert.match(tag[0], /href="[^"]*install\.cmd"/, tag[0]);
});

test('帮助页引用的截图都在 help/img 下', () => {
  const sources = [...html.matchAll(/src="(img\/[^"]+)"/g)].map(match => match[1]);
  assert.ok(sources.length > 0, '帮助页应当至少有步骤截图');
  const missing = sources.filter(source => !fs.existsSync(path.join(ROOT, 'help', source)));
  assert.deepEqual(missing, [], `缺少截图：${missing.join(', ')}`);
});

test('帮助页读的是通道里真实存在的清单名', () => {
  // 通道里的 Agent 清单叫 cloudfile-agent2-update.json；update.json 是 Go 时代的老名字，
  // 只作回退。写错的话底部「当前最新版本」永远是 —。
  assert.match(html, /cloudfile-agent2-update\.json/, '应当按真实文件名读 Agent 清单');
  assert.match(html, /extension-update\.json/, '应当读扩展清单');
});

test('页面内联脚本语法正确', () => {
  for (const block of scriptBlocks()) {
    assert.doesNotThrow(() => new Function(block));
  }
});
