export class BoardSourceError extends Error {
  constructor(
    message: string,
    readonly kind: "configuration" | "timeout" | "upstream" | "validation",
    readonly status: number
  ) {
    super(message);
  }
}
