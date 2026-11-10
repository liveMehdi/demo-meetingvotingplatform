export class CreationAttempt<T> {
  private current: { key: string; input: T; encoded: string } | null = null;
  private uncertain = false;
  private inFlight: Promise<unknown> | null = null;
  constructor(private newKey = () => crypto.randomUUID()) {}

  get retryInput(): T | null {
    return this.uncertain ? this.current!.input : null;
  }
  reset() {
    this.current = null;
    this.uncertain = false;
  }

  async run<R>(
    input: T,
    send: (input: T, key: string) => Promise<R>,
  ): Promise<R> {
    const encoded = JSON.stringify(input);
    if (this.current && this.current.encoded !== encoded) {
      throw new Error(
        "We couldn't confirm whether it saved. Retry with your original entries first.",
      );
    }

    if (this.inFlight) return this.inFlight as Promise<R>;
    this.current ??= {
      key: this.newKey(),
      input: JSON.parse(encoded) as T,
      encoded,
    };

    const request = this.current;
    this.inFlight = this.send(request, send);
    try {
      return (await this.inFlight) as R;
    } finally {
      this.inFlight = null;
    }
  }

  private async send<R>(
    request: { key: string; input: T },
    send: (input: T, key: string) => Promise<R>,
  ): Promise<R> {
    try {
      const result = await send(request.input, request.key);
      this.reset();
      return result;
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? error.status
          : null;

      if (
        !this.uncertain &&
        [400, 401, 403, 404, 409, 422].includes(status as number)
      )
        this.reset();
      else this.uncertain = true;
      throw error;
    }
  }
}
