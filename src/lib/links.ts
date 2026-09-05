const allowedExternalSchemes = new Set(["http", "https", "mailto"]);

export function normalizeLinkTarget(input: string): string {
  const target = input.trim();
  if (!target) throw new Error("链接地址不能为空");
  if (/[\u0000-\u001f\u007f]/.test(target)) throw new Error("链接地址不能包含控制字符");
  if (target.startsWith("//")) throw new Error("不支持省略协议的链接地址");

  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(target)?.[1]?.toLocaleLowerCase();
  if (scheme && !allowedExternalSchemes.has(scheme)) {
    throw new Error(`不支持的链接协议：${scheme}`);
  }
  return target;
}

export function isExternalLink(input: string): boolean {
  try {
    const target = normalizeLinkTarget(input);
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(target)?.[1]?.toLocaleLowerCase();
    return Boolean(scheme && allowedExternalSchemes.has(scheme));
  } catch {
    return false;
  }
}
