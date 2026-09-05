declare module "pagedjs" {
  export interface PreviewFlow {
    total: number;
    performance: number;
  }

  export class Previewer {
    preview(
      content?: HTMLElement | DocumentFragment | string,
      stylesheets?: Array<string | object>,
      renderTo?: HTMLElement | string,
    ): Promise<PreviewFlow>;
  }
}
