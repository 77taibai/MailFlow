export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return hm;
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()}/${md}`;
}

export function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// 邮件正文在 sandbox iframe（无 allow-scripts / allow-same-origin）里用 srcdoc 渲染。
// 若链接没有 target，点击后会在 iframe 内导航，把正文顶掉、且地址栏不可见，容易被钓鱼仿冒；
// 这里统一把正文里的链接改成在新标签打开，并补 rel 防止 opener 劫持。
export function prepareMailHtml(html) {
  if (!html || typeof html !== 'string') return html;

  // 1) 给 <a> / <area> 显式加 target="_blank" 与 rel="noopener noreferrer"
  let out = html.replace(/<(a|area)\b([^>]*)>/gi, (tag, name, attrs) => {
    if (/\btarget\s*=/i.test(attrs)) {
      attrs = attrs.replace(/\btarget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, 'target="_blank"');
    } else {
      attrs += ' target="_blank"';
    }
    if (/\brel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.test(attrs)) {
      attrs = attrs.replace(/\brel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, (m, val) => {
        const clean = val.replace(/^["']|["']$/g, '');
        const tokens = new Set(clean.split(/\s+/).filter(Boolean));
        tokens.add('noopener');
        tokens.add('noreferrer');
        return `rel="${[...tokens].join(' ')}"`;
      });
    } else {
      attrs += ' rel="noopener noreferrer"';
    }
    return `<${name}${attrs}>`;
  });

  // 2) 兜底：<base target="_blank"> 覆盖所有链接（含 <area>、脚本拼接出来的等）
  //    若正文自带 <base>，就地补/改 target，避免破坏它原有的 href 语义。
  const existingBase = out.match(/<base\b[^>]*>/i);
  if (existingBase) {
    const tag = existingBase[0];
    const patched = /\btarget\s*=/i.test(tag)
      ? tag.replace(/\btarget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, 'target="_blank"')
      : tag.replace(/<base/i, '<base target="_blank"');
    return out.replace(tag, patched);
  }

  const base = '<base target="_blank">';
  if (/<head[\s>]/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  } else if (/<html[\s>]/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${base}</head>`);
  } else {
    const dt = out.match(/<!doctype[^>]*>/i);
    if (dt) {
      const end = dt.index + dt[0].length;
      out = `${out.slice(0, end)}<head>${base}</head>${out.slice(end)}`;
    } else {
      out = `<head>${base}</head>${out}`;
    }
  }
  return out;
}
