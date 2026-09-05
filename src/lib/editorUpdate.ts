import type { Transaction } from "@tiptap/pm/state";

export function shouldEmitEditorUpdate(transaction: Pick<Transaction, "docChanged">): boolean {
  return transaction.docChanged;
}
