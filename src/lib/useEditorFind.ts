import { useEffect, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { SearchQuery, setSearchQuery } from "@codemirror/search";
import type { Editor } from "@tiptap/core";
import {
  findStringMatches,
  findTextMatches,
  replaceAllMatches,
  replaceStringMatches,
  replaceTextMatch,
  selectTextMatch,
  showFindMatches,
} from "./findReplace";

interface EditorFindOptions {
  editor: Editor | null;
  markdownText: string;
  sourceMode: boolean;
  sourceText: string;
  codeMirror: RefObject<ReactCodeMirrorRef | null>;
  findInput: RefObject<HTMLInputElement | null>;
  suppressSelectionUpdate: MutableRefObject<boolean>;
  setSelectionPopover: Dispatch<SetStateAction<{ left: number; top: number } | null>>;
  publishSourceReplacement: (source: string) => void;
}

export function useEditorFind(options: EditorFindOptions) {
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const {
    editor, markdownText, sourceMode, sourceText, codeMirror, findInput,
    suppressSelectionUpdate, setSelectionPopover, publishSourceReplacement,
  } = options;

  useEffect(() => {
    if (!findOpen) return;
    window.requestAnimationFrame(() => {
      findInput.current?.focus();
      findInput.current?.select();
    });
  }, [findInput, findOpen]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (!findOpen || sourceMode) {
      showFindMatches(editor, "", 0);
      return;
    }
    const matches = findTextMatches(editor.state.doc, findQuery);
    const activeIndex = matches.length ? Math.min(findIndex, matches.length - 1) : 0;
    showFindMatches(editor, findQuery, activeIndex);
    const match = matches[activeIndex];
    if (!match) return;
    suppressSelectionUpdate.current = true;
    selectTextMatch(editor, match);
    suppressSelectionUpdate.current = false;
    setSelectionPopover(null);
  }, [editor, findIndex, findOpen, findQuery, markdownText, setSelectionPopover, sourceMode, suppressSelectionUpdate]);

  useEffect(() => {
    const view = codeMirror.current?.view;
    if (!sourceMode || !view) return;
    const query = findOpen ? findQuery : "";
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive: false, literal: true })) });
    const matches = findStringMatches(sourceText, query);
    const activeIndex = matches.length ? Math.min(findIndex, matches.length - 1) : 0;
    const match = matches[activeIndex];
    if (match) view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
  }, [codeMirror, findIndex, findOpen, findQuery, sourceMode, sourceText]);

  const matches = findQuery
    ? sourceMode
      ? findStringMatches(sourceText, findQuery)
      : editor ? findTextMatches(editor.state.doc, findQuery) : []
    : [];
  const activeFindIndex = matches.length ? Math.min(findIndex, matches.length - 1) : 0;
  const moveToMatch = (direction: 1 | -1) => {
    if (matches.length) setFindIndex((activeFindIndex + direction + matches.length) % matches.length);
  };
  const replaceCurrentMatch = () => {
    const match = matches[activeFindIndex];
    if (!match) return;
    if (sourceMode) publishSourceReplacement(replaceStringMatches(sourceText, [match], replacement));
    else if (editor) replaceTextMatch(editor, match, replacement);
    setFindIndex(Math.min(activeFindIndex, Math.max(0, matches.length - 2)));
  };
  const replaceEveryMatch = () => {
    if (!matches.length) return;
    if (sourceMode) publishSourceReplacement(replaceStringMatches(sourceText, matches, replacement));
    else if (editor) replaceAllMatches(editor, matches, replacement);
    setFindIndex(0);
  };

  return {
    findOpen, setFindOpen, findQuery, setFindQuery, replacement, setReplacement,
    findIndex, setFindIndex, matches, activeFindIndex, moveToMatch,
    replaceCurrentMatch, replaceEveryMatch,
  };
}
