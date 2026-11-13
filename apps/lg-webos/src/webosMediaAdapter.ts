// LG webOS Native Media & Hardware Remote Adapter

declare const webOS: {
  platformBack?: () => void;
  deviceInfo?: (cb: (info: { modelName: string; version: string }) => void) => void;
};

export function detectWebOsCapabilities(): {
  isWebOs: boolean;
  supportsNativeHls: boolean;
  supportsMpegTsInVideoTag: boolean;
} {
  const isWebOs = typeof webOS !== 'undefined';
  const video = typeof document !== 'undefined' ? document.createElement('video') : null;
  const supportsNativeHls = Boolean(
    video && video.canPlayType('application/vnd.apple.mpegurl') !== ''
  );
  const supportsMpegTsInVideoTag = Boolean(
    video && video.canPlayType('video/mp2t') !== ''
  );

  return {
    isWebOs,
    supportsNativeHls,
    supportsMpegTsInVideoTag,
  };
}

export function triggerWebOsBack() {
  if (typeof webOS !== 'undefined' && typeof webOS.platformBack === 'function') {
    webOS.platformBack();
  }
}
