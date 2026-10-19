/**
 * tools/check-imports.mjs — 静态检查所有相对导入是否真实存在。
 * 用法：node tools/check-imports.mjs
 * 目的：ES Module 的导入错误在 node --check 阶段发现不了，必须在浏览器才会暴露。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      check(full);
    }
  }
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\s*\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g;

function check(file) {
  const src = fs.readFileSync(file, 'utf8');
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue; // three / importmap 由浏览器解析
      // 忽略模板字符串里的占位（动态拼接的目录）
      if (spec.includes('${')) continue;
      const target = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(target)) {
        errors.push(`${path.relative(ROOT, file)}  →  ${spec}`);
      }
    }
  }
}

// 扫描 index.html 里的 script/link 引用
function checkHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const re = /(?:src|href)="(\.\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const target = path.join(ROOT, m[1]);
    if (!fs.existsSync(target)) errors.push(`index.html  →  ${m[1]}`);
  }
}

walk(path.join(ROOT, 'src'));
checkHtml();

if (errors.length) {
  console.error('❌ 以下导入目标不存在：');
  for (const e of errors) console.error('   ' + e);
  process.exit(1);
} else {
  console.log('✅ 所有相对导入均存在。');
}
