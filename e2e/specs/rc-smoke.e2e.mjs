import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

const workspace = process.env.YULING_E2E_WORKSPACE;

async function libraryText() {
  return browser.execute(() => document.querySelector("nav[aria-label='文档库']")?.textContent ?? "");
}

async function waitForLibraryText(name, present = true) {
  await browser.waitUntil(async () => (await libraryText()).includes(name) === present, {
    timeout: 2_500,
    interval: 50,
    timeoutMsg: `${name} did not become ${present ? "visible" : "hidden"} in the document library`,
  });
}

async function folderIsVisible(name) {
  return browser.execute((value) => Array.from(
    document.querySelectorAll(".tree-folder-row .tree-name"),
  ).some((node) => node.textContent === value), name);
}

async function waitForFolder(name, present = true) {
  await browser.waitUntil(async () => (await folderIsVisible(name)) === present, {
    timeout: 2_500,
    interval: 50,
    timeoutMsg: `${name} did not become ${present ? "visible" : "hidden"} in the document tree`,
  });
}

async function insertEditorText(text) {
  return browser.execute((value) => {
    const editor = document.querySelector(".ProseMirror");
    if (!(editor instanceof HTMLElement)) return false;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return document.execCommand("insertText", false, value);
  }, text);
}

async function importSyntheticImage(entry, name) {
  return browser.execute(({ kind, fileName }) => {
    const editor = document.querySelector(".ProseMirror");
    const input = document.querySelector("input[aria-label='选择图片文件']");
    if (!(editor instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return false;
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], fileName, { type: "image/png" }));
    if (kind === "input") {
      Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    const event = new Event(kind === "paste" ? "paste" : "drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, kind === "paste" ? "clipboardData" : "dataTransfer", { value: transfer });
    if (kind === "drop") {
      const bounds = editor.getBoundingClientRect();
      Object.defineProperties(event, {
        clientX: { value: bounds.left + 20 },
        clientY: { value: bounds.top + 20 },
      });
    }
    editor.dispatchEvent(event);
    return true;
  }, { kind: entry, fileName: name });
}

describe("YuLing MD release-shaped macOS application", () => {
  before(async () => {
    assert.ok(workspace && path.isAbsolute(workspace), "YULING_E2E_WORKSPACE must be absolute");
    await browser.waitUntil(() => browser.execute(() => document.querySelector("main.app-shell") !== null));
    await browser.execute((root) => {
      localStorage.clear();
      localStorage.setItem("yuling-md-session-v1", JSON.stringify({
        version: 1,
        workspace: root,
        tabs: ["RC-真实样本.md"],
        active: "RC-真实样本.md",
      }));
    }, workspace);
    await browser.refresh();
    await browser.waitUntil(() => browser.execute(() => (
      document.querySelector("section[aria-label='Markdown 编辑器']") !== null
    )), { timeout: 10_000 });
  });

  it("restores only the marked test workspace and its active document", async () => {
    assert.match(await browser.execute(() => document.querySelector(".workspace-location")?.textContent ?? ""), /yuling-e2e-/);
    assert.match(await libraryText(), /RC-真实样本/);
    assert.match(await browser.execute(() => document.querySelector(".tab-title")?.textContent ?? ""), /RC-真实样本/);
  });

  it("renders the real Markdown fixture through production editor extensions", async () => {
    const structure = await browser.execute(() => ({
      code: document.querySelector(".ProseMirror pre code") !== null,
      math: document.querySelector(".yuling-math-inline, .yuling-math-block") !== null,
      table: document.querySelector(".ProseMirror table") !== null,
    }));
    assert.deepEqual(structure, { code: true, math: true, table: true });
    await browser.waitUntil(() => browser.execute(() => (
      Array.from(document.querySelectorAll(".ProseMirror table col")).map((column) => column.style.width).join(",") === "180px,120px,120px"
    )), { timeout: 5_000, timeoutMsg: "saved table layout was not restored when the document reopened" });
    await browser.waitUntil(() => browser.execute(() => (
      document.querySelector("img.yuling-image-missing") !== null
    )), { timeout: 5_000, timeoutMsg: "missing local image did not show its recovery placeholder" });
  });

  it("reflects external Markdown create, rename, move, and delete events", async () => {
    const created = path.join(workspace, "外部新增.md");
    const folder = path.join(workspace, "外部目录");
    const renamed = path.join(folder, "外部重命名.md");

    await fs.writeFile(created, "# 外部新增\n", "utf8");
    await waitForLibraryText("外部新增");

    await fs.mkdir(folder);
    await waitForFolder("外部目录");
    await browser.execute(() => document.querySelector("button[aria-label='展开全部目录']")?.click());
    await fs.rename(created, renamed);
    await waitForLibraryText("外部重命名");
    await waitForLibraryText("外部新增", false);

    await fs.unlink(renamed);
    await waitForLibraryText("外部重命名", false);
    await fs.rmdir(folder);
    await waitForFolder("外部目录", false);
  });

  it("auto-saves edits, switches documents, and surfaces an external-write conflict", async () => {
    assert.equal(await insertEditorText("\nE2E 自动保存标记"), true);
    await browser.waitUntil(async () => (await fs.readFile(path.join(workspace, "RC-真实样本.md"), "utf8")).includes("E2E 自动保存标记"), {
      timeout: 4_000,
      interval: 100,
      timeoutMsg: "editor change was not persisted by the 700ms auto-save path",
    });

    const second = path.join(workspace, "第二篇.md");
    await fs.writeFile(second, "# 第二篇\n", "utf8");
    await waitForLibraryText("第二篇");
    await browser.execute(() => document.querySelector("[title='第二篇.md']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".tab.active .tab-title")?.textContent?.includes("第二篇")));
    await browser.execute(() => document.querySelector("[title='RC-真实样本.md']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".tab.active .tab-title")?.textContent?.includes("RC-真实样本")));

    const current = await fs.readFile(path.join(workspace, "RC-真实样本.md"), "utf8");
    await fs.writeFile(path.join(workspace, "RC-真实样本.md"), `${current}\n外部版本`, "utf8");
    assert.equal(await insertEditorText("\n本地冲突版本"), true);
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".conflict-banner")?.textContent?.includes("其他程序中改变") ?? false), {
      timeout: 4_000,
      timeoutMsg: "external modification did not produce the conflict recovery banner",
    });
    await browser.execute(() => Array.from(document.querySelectorAll(".conflict-banner button"))
      .find((button) => button.textContent?.includes("重新加载"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".conflict-banner") === null));
  });

  it("persists a table column resize across an application reload", async () => {
    const resized = await browser.execute(() => {
      const cell = document.querySelector(".ProseMirror table th");
      if (!(cell instanceof HTMLElement)) return null;
      const bounds = cell.getBoundingClientRect();
      const boundary = bounds.right - 1;
      cell.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: boundary, clientY: bounds.top + 8 }));
      cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, clientX: boundary, clientY: bounds.top + 8 }));
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: boundary + 30, clientY: bounds.top + 8 }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: boundary + 30, clientY: bounds.top + 8 }));
      return Array.from(document.querySelectorAll(".ProseMirror table col")).map((column) => column.style.width);
    });
    assert.ok(resized?.some((width) => Number.parseFloat(width) > 0), JSON.stringify(resized));
    const expectedWidths = resized.map((width) => Math.round(Number.parseFloat(width)));
    await browser.waitUntil(async () => {
      try {
        const layout = JSON.parse(await fs.readFile(path.join(workspace, ".yulingmd/layout.json"), "utf8"));
        return (layout.documents?.["RC-真实样本.md"] ?? []).some((table) => table.widths?.join(",") === expectedWidths.join(","));
      } catch {
        return false;
      }
    }, { timeout: 4_000, timeoutMsg: "table widths were not persisted to layout v2" });
    await browser.execute(() => document.querySelector("[title='第二篇.md']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".tab.active .tab-title")?.textContent?.includes("第二篇")));
    await browser.execute(() => Array.from(document.querySelectorAll(".tab"))
      .find((tab) => tab.querySelector(".tab-title")?.textContent?.includes("RC-真实样本"))
      ?.querySelector(".tab-close")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await browser.waitUntil(() => browser.execute(() => Array.from(document.querySelectorAll(".tab-title"))
      .every((tab) => !tab.textContent?.includes("RC-真实样本"))));
    await browser.execute(() => document.querySelector("[title='RC-真实样本.md']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".ProseMirror table col") !== null));
    await browser.waitUntil(() => browser.execute((expected) => (
      Array.from(document.querySelectorAll(".ProseMirror table col")).map((column) => column.style.width).join(",") === expected.join(",")
    ), resized), { timeout: 5_000, timeoutMsg: "saved table widths were not restored after switching away and reopening" });
  });

  it("imports pasted, dropped, and selected images and repairs a missing image", async () => {
    await browser.execute(() => document.querySelector("img.yuling-image-missing")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".image-missing-bar") !== null));
    await browser.execute(() => Array.from(document.querySelectorAll(".image-missing-bar button"))
      .find((button) => button.textContent?.includes("重新定位"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    assert.equal(await importSyntheticImage("input", "修复.png"), true);
    await browser.waitUntil(async () => !(await fs.readFile(path.join(workspace, "RC-真实样本.md"), "utf8")).includes("missing.png"), {
      timeout: 4_000,
      timeoutMsg: "repaired image path was not auto-saved to Markdown",
    });

    const before = await browser.execute(() => document.querySelectorAll(".ProseMirror img").length);
    assert.equal(await importSyntheticImage("paste", "粘贴.png"), true);
    await browser.waitUntil(() => browser.execute((count) => document.querySelectorAll(".ProseMirror img").length >= count + 1, before), {
      timeout: 5_000, timeoutMsg: "pasted image did not insert a node",
    });
    assert.equal(await importSyntheticImage("drop", "拖入.png"), true);
    await browser.waitUntil(() => browser.execute((count) => document.querySelectorAll(".ProseMirror img").length >= count + 2, before), {
      timeout: 5_000, timeoutMsg: "dropped image did not insert a node",
    });
    assert.equal(await importSyntheticImage("input", "选择.png"), true);
    await browser.waitUntil(() => browser.execute((count) => document.querySelectorAll(".ProseMirror img").length >= count + 3, before), {
      timeout: 5_000,
      timeoutMsg: "the three image entry points did not all insert nodes",
    });
    await browser.waitUntil(async () => (await fs.readdir(path.join(workspace, "assets", String(new Date().getFullYear())))).length > 0, {
      timeout: 5_000,
      timeoutMsg: "imported image was not copied into the workspace asset store",
    });
    await browser.execute(() => document.querySelector("[title='第二篇.md']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".tab.active .tab-title")?.textContent?.includes("第二篇")));
    await browser.execute(() => document.querySelector("[title='RC-真实样本.md']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await browser.waitUntil(() => browser.execute(() => document.querySelectorAll(".ProseMirror img:not(.yuling-image-missing)").length >= 4));
  });

  it("keeps a WebKit selection through release, contextmenu, and opening AI 知了", async () => {
    for (let index = 0; index < 20; index += 1) {
      const selected = await browser.execute(() => {
        const root = document.querySelector(".ProseMirror");
        if (!root) return "";
        root.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1 }));
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const start = node.textContent?.indexOf("连续选择验证") ?? -1;
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + "连续选择验证".length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
          window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
          return selection?.toString() ?? "";
        }
        return "";
      });
      assert.equal(selected, "连续选择验证");
      await browser.pause(50);
      const state = await browser.execute(() => ({
        popover: document.querySelector(".selection-popover") !== null,
        selection: window.getSelection()?.toString() ?? "",
      }));
      assert.equal(state.popover, true, JSON.stringify(state));
      assert.ok(state.selection.trim(), JSON.stringify(state));
    }

    await browser.execute(() => document.querySelector(".ProseMirror")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 })));
    assert.ok((await browser.execute(() => window.getSelection()?.toString() ?? "")).trim());

    await browser.execute(() => document.querySelector(".selection-popover")?.click());
    await browser.waitUntil(() => browser.execute(() => !document.querySelector("aside.ai-panel")?.hasAttribute("hidden")));
    assert.ok((await browser.execute(() => window.getSelection()?.toString() ?? "")).trim());
  });
});
