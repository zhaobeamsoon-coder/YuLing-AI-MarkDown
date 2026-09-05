// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { shouldPublishNativeSelection } from "../lib/persistentSelection";
import { EditorPane, shouldReplaceEditorDocument, shouldStartPointerSelection } from "./EditorPane";
import { Schema } from "@tiptap/pm/model";

const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
const originalRangeBoundingClientRect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
const originalClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard");
const originalPointerEvent = Object.getOwnPropertyDescriptor(window, "PointerEvent");

function stubRangeRects() {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalRangeClientRects) {
    Object.defineProperty(Range.prototype, "getClientRects", originalRangeClientRects);
  } else {
    Reflect.deleteProperty(Range.prototype, "getClientRects");
  }
  if (originalRangeBoundingClientRect) {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", originalRangeBoundingClientRect);
  } else {
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  }
  if (originalClipboard) {
    Object.defineProperty(Navigator.prototype, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(Navigator.prototype, "clipboard");
  }
  if (originalPointerEvent) {
    Object.defineProperty(window, "PointerEvent", originalPointerEvent);
  } else {
    Reflect.deleteProperty(window, "PointerEvent");
  }
});

describe("EditorPane interactions", () => {
  it("replaces the editor document only when the restored structure differs", () => {
    const schema = new Schema({ nodes: { doc: { content: "text*" }, text: {} } });
    const current = schema.node("doc", null, [schema.text("相同")]);
    const equal = schema.node("doc", null, [schema.text("相同")]);
    const changed = schema.node("doc", null, [schema.text("不同")]);

    expect(shouldReplaceEditorDocument(current, equal)).toBe(false);
    expect(shouldReplaceEditorDocument(current, changed)).toBe(true);
  });

  it("does not clear a selection when equivalent layouts arrive with fresh array identities", async () => {
    const published: string[] = [];
    const tableLayouts = [{ anchor: "root#0", widths: [140, 140] }];
    function ProductionShapedPane() {
      const [, setSelection] = useState("");
      return <EditorPane workspace="/资料库" documentPath="/资料库/表格.md"
        markdownText={'正文可选\n\n| A | B |\n| - | - |\n| 1 | 2 |'}
        tableLayouts={tableLayouts} imageLayouts={[]}
        onChange={vi.fn()} onOpenAi={vi.fn()}
        onSelection={(text) => { published.push(text); setSelection(text); }} />;
    }
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [{ left: 100, right: 100, top: 100, bottom: 118, width: 0, height: 18 }],
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
    });
    render(<ProductionShapedPane />);
    const paragraph = await screen.findByText("正文可选", { selector: "p" });
    const text = paragraph.firstChild!;
    paragraph.addEventListener("mousedown", (event) => event.stopPropagation(), { once: true });
    paragraph.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 20 }));
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(window, { button: 0, clientX: 100 });

    await waitFor(() => expect(published).toContain("正文可选"));
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(published.at(-1)).toBe("正文可选");
    expect(screen.getByRole("button", { name: "知了知道" })).toBeTruthy();
  });

  it("restores an image layout without requiring a table layout", async () => {
    render(<EditorPane workspace="/资料库" documentPath="/资料库/图片.md"
      markdownText="![示例](assets/example.png)" tableLayouts={[]}
      imageLayouts={[{ key: "assets/example.png#0", width: 320 }]}
      onChange={vi.fn()} onSelection={vi.fn()} onOpenAi={vi.fn()} />);

    await waitFor(() => expect(document.querySelector("img")?.getAttribute("data-yuling-image-width")).toBe("320"));
  });

  it("reloads a genuine external Markdown change", async () => {
    const props = {
      workspace: "/资料库",
      documentPath: "/资料库/外部更新.md",
      tableLayouts: [],
      onChange: vi.fn(),
      onSelection: vi.fn(),
      onOpenAi: vi.fn(),
    };
    const { rerender } = render(<EditorPane {...props} markdownText="旧正文" />);
    await screen.findByText("旧正文", { selector: "p" });

    rerender(<EditorPane {...props} markdownText="外部正文" />);
    expect(await screen.findByText("外部正文", { selector: "p" })).toBeTruthy();
    expect(screen.queryByText("旧正文", { selector: "p" })).toBeNull();
  });

  it("ignores WebKit collapsed selectionchange events after a published selection", () => {
    const editorDom = document.createElement("div");
    const textNode = document.createTextNode("已选文字");
    editorDom.append(textNode);
    document.body.append(editorDom);
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(shouldPublishNativeSelection(selection, editorDom)).toBe(false);
  });

  it("leaves Cmd+Shift+F to the workspace search handler", async () => {
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/快捷键.md"
        markdownText="正文"
        tableLayouts={[]}
        onChange={vi.fn()}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );
    await screen.findAllByText("正文");

    fireEvent.keyDown(window, { key: "f", metaKey: true, shiftKey: true });

    expect(screen.queryByPlaceholderText("查找内容")).toBeNull();
  });

  it("starts native selection even when an editor node already handled the press", () => {
    const event = new MouseEvent("mousedown", { button: 0, clientX: 20, cancelable: true });
    event.preventDefault();

    expect(event.defaultPrevented).toBe(true);
    expect(shouldStartPointerSelection(event)).toBe(true);
  });

  it("opens ordinary Markdown when the cursor is not inside a table", async () => {
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/普通文档.md"
        markdownText={`# 普通文档

这里不是表格。`}
        tableLayouts={[]}
        onChange={vi.fn()}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "普通文档" })).toBeTruthy();
    expect(screen.getByText("这里不是表格。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "居中" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders raw HTML as inert text instead of executable DOM", async () => {
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/不可信.md"
        markdownText={'# 安全\n\n<details><script>window.__unsafe = true</script></details>'}
        tableLayouts={[]}
        onChange={vi.fn()}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );

    await screen.findByText(/<details><script>/);
    const raw = document.querySelector("[data-yuling-raw-markdown]");
    expect(raw?.textContent).toContain("<details><script>");
    expect((raw as HTMLElement | null)?.contentEditable).toBe("false");
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
  });

  it("waits for primary-button release before publishing a native drag selection", async () => {
    const onSelection = vi.fn();
    const onChange = vi.fn();
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/划词测试.md"
        markdownText="触控板拖选这段文字"
        tableLayouts={[]}
        onChange={onChange}
        onSelection={onSelection}
        onOpenAi={vi.fn()}
      />,
    );

    const paragraph = await screen.findByText("触控板拖选这段文字");
    const textNode = paragraph.firstChild!;
    onSelection.mockClear();
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [{ left: 100, right: 100, top: 100, bottom: 118, width: 0, height: 18 }],
    });
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600, x: 0, y: 0,
      toJSON: () => ({}),
    });
    paragraph.addEventListener("mousedown", (event) => event.stopPropagation(), { once: true });

    const press = new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 20 });
    press.preventDefault();
    paragraph.dispatchEvent(press);

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const nativeSelection = window.getSelection()!;
    nativeSelection.removeAllRanges();
    nativeSelection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    expect(onSelection).not.toHaveBeenCalled();
    fireEvent.mouseUp(window, { clientX: 100 });

    await waitFor(() => expect(onSelection).toHaveBeenCalledWith("触控板拖选"));
    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "知了知道" })).toBeTruthy();
    expect(document.querySelector(".yuling-persistent-selection")?.textContent).toBe("触控板拖选");

    const collapsedRange = document.createRange();
    collapsedRange.setStart(textNode, 5);
    collapsedRange.collapse(true);
    nativeSelection.removeAllRanges();
    nativeSelection.addRange(collapsedRange);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    expect(screen.getByRole("button", { name: "知了知道" })).toBeTruthy();
    expect(onSelection).not.toHaveBeenLastCalledWith("");
    expect(onChange).not.toHaveBeenCalled();
    expect(bounds).toHaveBeenCalled();
  });

  it("keeps the last stable selection when WebKit cancels a pointer gesture", async () => {
    Object.defineProperty(window, "PointerEvent", { configurable: true, value: MouseEvent });
    const onSelection = vi.fn();
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/取消手势.md"
        markdownText="保留已经选中的文字"
        tableLayouts={[]}
        onChange={vi.fn()}
        onSelection={onSelection}
        onOpenAi={vi.fn()}
      />,
    );
    const paragraph = await screen.findByText("保留已经选中的文字");
    const textNode = paragraph.firstChild!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600, x: 0, y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [{ left: 100, right: 100, top: 100, bottom: 118, width: 0, height: 18 }],
    });
    const selection = window.getSelection()!;
    const selectedRange = document.createRange();
    selectedRange.setStart(textNode, 0);
    selectedRange.setEnd(textNode, 4);
    fireEvent.pointerDown(paragraph, { button: 0, clientX: 20 });
    selection.removeAllRanges();
    selection.addRange(selectedRange);
    fireEvent.pointerUp(window, { button: 0, clientX: 100 });
    await waitFor(() => expect(onSelection).toHaveBeenCalledWith("保留已经"));

    fireEvent.pointerDown(paragraph, { button: 0, clientX: 20 });
    const collapsedRange = document.createRange();
    collapsedRange.setStart(textNode, 4);
    collapsedRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(collapsedRange);
    fireEvent.pointerCancel(window);

    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(screen.getByRole("button", { name: "知了知道" })).toBeTruthy();
    expect(onSelection).not.toHaveBeenLastCalledWith("");
  });

  it("opens a flat Emoji grid and inserts one at the visual editor selection", async () => {
    stubRangeRects();
    const onChange = vi.fn();
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/Emoji.md"
        markdownText="正文"
        tableLayouts={[]}
        onChange={onChange}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );
    const paragraph = await screen.findByText("正文", { selector: "p" });
    fireEvent.click(paragraph);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Emoji" }));
    fireEvent.click(screen.getByRole("button", { name: "Emoji" }));

    expect(screen.getByRole("grid", { name: "Emoji 选择" })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("button", { name: "插入 💡" }));
    fireEvent.click(screen.getByRole("button", { name: "插入 💡" }));

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("💡"));
    expect(screen.queryByRole("grid", { name: "Emoji 选择" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).not.toContain("💡"));
  });

  it("inserts an Emoji into the current Markdown source selection", async () => {
    stubRangeRects();
    const onChange = vi.fn();
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/源码-Emoji.md"
        markdownText="abc"
        tableLayouts={[]}
        onChange={onChange}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Markdown 源码" }));
    fireEvent.click(screen.getByRole("button", { name: "Emoji" }));
    fireEvent.click(screen.getByRole("button", { name: "插入 ✅" }));

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("✅"));
  });

  it("finds, navigates and replaces visible text from the unified search bar", async () => {
    const onChange = vi.fn();
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/查找.md"
        markdownText="苹果 香蕉 苹果"
        tableLayouts={[]}
        onChange={onChange}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );
    await screen.findByText("苹果 香蕉 苹果");

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    fireEvent.change(screen.getByRole("searchbox", { name: "查找内容" }), { target: { value: "苹果" } });

    expect(await screen.findByText("1 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一个匹配" }));
    expect(await screen.findByText("2 / 2")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "替换为" }), { target: { value: "梨" } });
    fireEvent.click(screen.getByRole("button", { name: "替换当前" }));

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("苹果 香蕉 梨"));
  });

  it("uses the same find and replace bar in Markdown source mode", async () => {
    const onChange = vi.fn();
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [],
    });
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/源码查找.md"
        markdownText={"# 标题\n\n正文 标题"}
        tableLayouts={[]}
        onChange={onChange}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Markdown 源码" }));
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    fireEvent.change(screen.getByRole("searchbox", { name: "查找内容" }), { target: { value: "标题" } });
    expect(await screen.findByText("1 / 2")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "替换为" }), { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: "全部替换" }));

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe("# 新标题\n\n正文 新标题"));
  });

  it("offers complete basic formatting and H1-H6 paragraph styles", async () => {
    const onChange = vi.fn();
    const emptyRect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => emptyRect });
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/格式.md"
        markdownText="基础格式"
        tableLayouts={[]}
        onChange={onChange}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );
    await screen.findByText("基础格式");

    const style = screen.getByRole("combobox", { name: "段落样式" });
    expect(Array.from((style as HTMLSelectElement).options, (option) => option.text)).toEqual([
      "正文", "一级标题", "二级标题", "三级标题", "四级标题", "五级标题", "六级标题",
    ]);
    for (const name of ["斜体", "删除线", "行内代码", "无序列表", "有序列表", "任务列表", "引用", "分隔线", "撤销", "重做"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }

    fireEvent.change(style, { target: { value: "3" } });
    expect(await screen.findByRole("heading", { level: 3, name: "基础格式" })).toBeTruthy();
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("### 基础格式"));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).not.toContain("### 基础格式"));
  });

  it("opens a quiet document outline and jumps to the selected heading", async () => {
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/大纲.md"
        markdownText={"# 第一章\n\n正文\n\n## 第二节\n\n内容"}
        tableLayouts={[]}
        onChange={vi.fn()}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );

    await screen.findByRole("heading", { name: "第一章" });
    expect(screen.queryByRole("navigation", { name: "文档大纲" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "大纲" }));

    const outline = await screen.findByRole("navigation", { name: "文档大纲" });
    expect(outline).toBeTruthy();
    const second = screen.getByRole("button", { name: "第二节" });
    fireEvent.click(second);
    await waitFor(() => expect(second.getAttribute("aria-current")).toBe("location"));
  });

  it("inserts a safe Markdown link and rejects executable URLs", async () => {
    const onChange = vi.fn();
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/链接.md"
        markdownText="正文"
        tableLayouts={[]}
        onChange={onChange}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );
    await screen.findByText("正文", { selector: "p" });

    fireEvent.click(screen.getByRole("button", { name: "链接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "链接文字" }), { target: { value: "OpenAI" } });
    fireEvent.change(screen.getByRole("textbox", { name: "链接地址" }), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "应用链接" }));
    expect(await screen.findByText(/不支持的链接协议/)).toBeTruthy();
    expect(onChange.mock.calls.some((call) => String(call[0]).includes("javascript:"))).toBe(false);

    fireEvent.change(screen.getByRole("textbox", { name: "链接地址" }), { target: { value: "https://openai.com" } });
    fireEvent.click(screen.getByRole("button", { name: "应用链接" }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("[OpenAI](https://openai.com)"));
  });

  it("changes a fenced code block language without losing its code", async () => {
    const onChange = vi.fn();
    const writeText = vi.fn(async () => undefined);
    const emptyRect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => emptyRect });
    Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, get: () => ({ writeText }) });
    render(
      <EditorPane
        workspace="/资料库"
        documentPath="/资料库/代码.md"
        markdownText={"```python\nprint('毓灵')\n```"}
        tableLayouts={[]}
        onChange={onChange}
        onSelection={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );
    await waitFor(() => expect(document.querySelector("pre code")?.textContent).toBe("print('毓灵')"));

    const language = screen.getByRole("combobox", { name: "代码语言" }) as HTMLSelectElement;
    expect(language.disabled).toBe(false);
    expect(language.value).toBe("python");
    expect(screen.getByRole("button", { name: "复制代码" })).toBeTruthy();
    fireEvent.change(language, { target: { value: "typescript" } });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("```typescript\nprint('毓灵')"));
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("print('毓灵')"));
  });
});
