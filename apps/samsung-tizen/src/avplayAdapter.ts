// Samsung Tizen Smart TV AVPlay Native Playback Adapter
// Requires privileges: http://developer.samsung.com/privilege/avplay

declare const webapis: {
  avplay?: {
    open(url: string): void;
    close(): void;
    prepareAsync(onSuccess: () => void, onError: (err: unknown) => void): void;
    play(): void;
    pause(): void;
    stop(): void;
    setDisplayRect(x: number, y: number, width: number, height: number): void;
    setDisplayMethod(method: string): void;
    setCustomHeader(headersJson: string): void;
    setListener(listener: Record<string, (...args: unknown[]) => void>): void;
    setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void;
  };
};

export class TizenAvPlayAdapter {
  private isPrepared = false;

  tune(
    streamUrl: string,
    headers: Record<string, string>,
    onReady: () => void,
    onError: (message: string) => void
  ) {
    const avplay = typeof webapis !== 'undefined' ? webapis.avplay : undefined;
    if (!avplay) {
      onError('Tizen AVPlay API unavailable outside Samsung TV runtime.');
      return;
    }

    try {
      if (this.isPrepared) {
        avplay.stop();
        avplay.close();
        this.isPrepared = false;
      }

      avplay.open(streamUrl);
      if (Object.keys(headers).length > 0) {
        avplay.setCustomHeader(JSON.stringify(headers));
      }

      avplay.setDisplayRect(0, 0, 1920, 1080);
      avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');

      avplay.setListener({
        onerror: (eventType) => {
          onError(`AVPlay error: ${String(eventType)}`);
        },
      });

      avplay.prepareAsync(
        () => {
          this.isPrepared = true;
          avplay.play();
          onReady();
        },
        (err) => {
          onError(`AVPlay prepareAsync failed: ${String(err)}`);
        }
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Tizen AVPlay exception');
    }
  }

  destroy() {
    const avplay = typeof webapis !== 'undefined' ? webapis.avplay : undefined;
    if (avplay && this.isPrepared) {
      avplay.stop();
      avplay.close();
      this.isPrepared = false;
    }
  }
}
