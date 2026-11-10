import {
  err,
  ok,
  type ImageGenerator,
  type ImageRequest,
  type ImageResult,
  type Result,
  type TextGenerator,
  type TextRequest,
  type TextResult,
} from '@richardmcquiston01/ai-providers';

/** Fake text generator: returns a canned reply or a canned error. No network. */
export class FakeTextGenerator implements TextGenerator {
  public readonly requests: TextRequest[] = [];

  public constructor(
    public readonly provider: string = 'fake',
    public readonly model: string = 'fake-model',
    private readonly reply: string = 'fake text',
    private readonly failureMessage: string | null = null
  ) {}

  public async generateText(request: TextRequest): Promise<Result<TextResult>> {
    this.requests.push(request);
    if (this.failureMessage !== null) {
      return err(this.failureMessage);
    }
    return ok({ text: this.reply });
  }
}

/** Fake image generator: returns a canned result or a canned error. */
export class FakeImageGenerator implements ImageGenerator {
  public readonly requests: ImageRequest[] = [];

  public constructor(
    public readonly provider: string = 'fake',
    public readonly model: string = 'fake-image-model',
    private readonly result: ImageResult | null = null,
    private readonly failureMessage: string | null = null,
    private readonly modes: readonly string[] = []
  ) {}

  public async listModes(): Promise<Result<readonly string[]>> {
    return ok(this.modes);
  }

  public async generateImage(
    request: ImageRequest
  ): Promise<Result<ImageResult>> {
    this.requests.push(request);
    if (this.result === null || this.failureMessage !== null) {
      return err(
        this.failureMessage ?? 'FakeImageGenerator has no result configured.'
      );
    }
    return ok(this.result);
  }
}
