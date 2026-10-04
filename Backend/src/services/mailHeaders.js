function flattenAddresses(list) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.address === 'string' && entry.address) {
      out.push(entry);
    } else if (Array.isArray(entry.group)) {
      out.push(...flattenAddresses(entry.group));
    }
  }
  return out;
}

export function normalizeMessageId(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeMessageId(item);
      if (normalized) return normalized;
    }
    return null;
  }
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export function normalizeReferences(value) {
  let raw;
  if (Array.isArray(value)) raw = value;
  else if (value == null) raw = [];
  else raw = String(value).split(/\s+/);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const text = item == null ? '' : String(item).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export function firstAddress(group) {
  if (!group) return { name: null, address: null };
  if (typeof group === 'string') {
    const address = group.trim();
    return { name: null, address: address || null };
  }
  const list = Array.isArray(group) ? group : Array.isArray(group.value) ? group.value : [];
  const first = flattenAddresses(list)[0];
  if (!first) return { name: null, address: null };
  const name = typeof first.name === 'string' ? first.name.trim() : '';
  const address = typeof first.address === 'string' ? first.address.trim() : '';
  return { name: name || null, address: address || null };
}

export function addressText(group) {
  if (!group) return null;
  if (typeof group === 'string') return group.trim() || null;
  if (typeof group.text === 'string' && group.text.trim()) return group.text.trim();
  const list = Array.isArray(group.value) ? group.value : [];
  const parts = flattenAddresses(list)
    .map((a) => {
      const address = typeof a.address === 'string' ? a.address.trim() : '';
      if (!address) return '';
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      return name ? `"${name}" <${address}>` : address;
    })
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function safeSubject(value) {
  if (value == null) return '';
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

export function extractMailHeaders(parsed) {
  const headers = parsed && parsed.headers instanceof Map ? parsed.headers : null;
  const pick = (key, camel) => parsed?.[camel] ?? headers?.get(key);
  const from = firstAddress(pick('from', 'from'));
  const sender = firstAddress(pick('sender', 'sender'));
  const replyTo = firstAddress(pick('reply-to', 'replyTo'));
  return {
    messageId: normalizeMessageId(parsed?.messageId),
    inReplyTo: normalizeMessageId(parsed?.inReplyTo),
    references: normalizeReferences(parsed?.references),
    fromName: from.name,
    fromAddr: from.address,
    senderName: sender.name,
    senderAddr: sender.address,
    replyToName: replyTo.name,
    replyToAddr: replyTo.address,
    toList: addressText(pick('to', 'to')),
    ccList: addressText(pick('cc', 'cc')),
    date: safeDate(parsed?.date),
    subject: safeSubject(parsed?.subject),
    text: typeof parsed?.text === 'string' ? parsed.text : '',
    html: typeof parsed?.html === 'string' ? parsed.html : null,
  };
}
