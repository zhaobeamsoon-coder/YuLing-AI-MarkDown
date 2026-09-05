---
title: RC 真实样本
tags: [rc, regression]
---

# RC 真实样本

这是一段用于连续选择验证的中文文字。编辑器应当在右键、工具栏和知了面板打开后保留原始选区。

## 表格与公式

| 项目 | 状态 | 备注 |
| --- | --- | --- |
| 选择 | 稳定 | 多行文字 |
| 保存 | 自动 | 700ms |

行内公式 $E = mc^2$，块级公式如下：

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

## 代码块

```ts
export function greeting(name: string) {
  return `你好，${name}`;
}
```

## 图片、脚注与 HTML

![缺失图片](assets/2026/missing.png "用于缺失占位验证")

脚注引用[^rc]。

[^rc]: RC 回归脚注。

<details><summary>HTML 内容</summary>展开后仍应保留。</details>

```mermaid
flowchart LR
  A[写作] --> B[保存]
```

## 多行选择

第一行选择文字。
第二行包含 **粗体** 和 `行内代码`。
第三行用于跨节点选择。
