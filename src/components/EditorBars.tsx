import type { RefObject } from "react";
import { isExternalLink } from "../lib/links";

export interface LinkRange {
  from: number;
  to: number;
  existing: boolean;
}

export function FindReplaceBar(props: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  replacement: string;
  matchCount: number;
  activeIndex: number;
  setQuery: (value: string) => void;
  setReplacement: (value: string) => void;
  move: (direction: 1 | -1) => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
  close: () => void;
}) {
  return <div className="find-replace-bar" role="search" aria-label="当前文档查找与替换">
    <input ref={props.inputRef} type="search" aria-label="查找内容" placeholder="查找" value={props.query}
      onChange={(event) => props.setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter") props.move(event.shiftKey ? -1 : 1);
        if (event.key === "Escape") props.close();
      }} />
    <span className="find-count" aria-live="polite">{props.matchCount ? `${props.activeIndex + 1} / ${props.matchCount}` : "0 / 0"}</span>
    <button disabled={!props.matchCount} aria-label="上一个匹配" onClick={() => props.move(-1)}>↑</button>
    <button disabled={!props.matchCount} aria-label="下一个匹配" onClick={() => props.move(1)}>↓</button>
    <input aria-label="替换为" placeholder="替换为" value={props.replacement} onChange={(event) => props.setReplacement(event.target.value)} />
    <button disabled={!props.matchCount} aria-label="替换当前" onClick={props.replaceCurrent}>替换</button>
    <button disabled={!props.matchCount} aria-label="全部替换" onClick={props.replaceAll}>全部</button>
    <button aria-label="关闭查找" onClick={props.close}>×</button>
  </div>;
}

export function LinkEditorBar(props: {
  text: string;
  url: string;
  range: LinkRange | null;
  error: string | null;
  setText: (value: string) => void;
  setUrl: (value: string) => void;
  apply: () => void;
  remove: () => void;
  open: () => void;
  close: () => void;
}) {
  return <div className="link-editor-bar" role="group" aria-label="链接编辑">
    <input aria-label="链接文字" placeholder="显示文字" value={props.text} onChange={(event) => props.setText(event.target.value)} />
    <input aria-label="链接地址" placeholder="https:// 或相对路径" value={props.url}
      onChange={(event) => props.setUrl(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter") props.apply();
        if (event.key === "Escape") props.close();
      }} />
    <button aria-label="应用链接" onClick={props.apply}>应用</button>
    <button disabled={!props.range?.existing} aria-label="移除链接" onClick={props.remove}>移除</button>
    <button disabled={!isExternalLink(props.url)} aria-label="打开链接" onClick={props.open}>打开</button>
    <button aria-label="关闭链接编辑" onClick={props.close}>×</button>
    {props.error && <span className="link-error" role="alert">{props.error}</span>}
  </div>;
}
