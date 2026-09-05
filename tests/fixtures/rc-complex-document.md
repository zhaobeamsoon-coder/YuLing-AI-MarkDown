---
title: RC 真实文档回归
tags: [rc, 中文]
---

[toc]

# 长文档与混合内容

这是一段用于连续划词的中文正文，包含 **粗体**、*斜体*、`行内代码`、==高亮== 与行内公式 $E=mc^2$。

## 多层表格

| 项目 | 说明 | 状态 |
| :--- | :---: | ---: |
| 编辑器 | 很长的中文单元格内容，用于验证列宽与横向滚动 | 1 |
| 知了 | 右键后仍应保持选择 | 2 |

## 图片与引用

![存在图片](assets/2026/example.png "示例")

![缺失图片](assets/2026/missing.png)

> 引用中的多行文字
>
> 第二行包含[^note]脚注。

[^note]: 脚注内容需要无损保存。

## 代码与图表

```typescript
const value: number = 42;
console.log(value);
```

```mermaid
flowchart LR
  A[开始] --> B{检查}
  B -->|通过| C[完成]
```

## 原始与未知语法

<details data-yuling="keep">
<summary>原始 HTML</summary>
<custom-element value="1">不可丢失</custom-element>
</details>

:::warning {#keep}
未知容器必须逐字保留。
:::

$$
\int_0^1 x^2 dx = \frac{1}{3}
$$

<!-- yuling:pagebreak -->

# 第二页

结束段落用于大纲跳转和长文档滚动。
