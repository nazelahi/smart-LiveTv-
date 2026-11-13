export type RemoteAction =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'SELECT'
  | 'BACK'
  | 'MENU'
  | 'CHANNEL_UP'
  | 'CHANNEL_DOWN'
  | 'PLAY_PAUSE'
  | 'INFO'
  | 'DIGIT';

export interface RemoteEvent {
  action: RemoteAction;
  digit?: string;
  isRepeat: boolean;
}

type Listener = (event: RemoteEvent) => void;

/**
 * Centralized RemoteKeyManager for Smart TV interfaces.
 * Normalizes keyboard, Android TV D-pad, Samsung Tizen, and LG webOS key codes,
 * handles key-repeat throttling, and maintains a numeric channel input buffer.
 */
export class RemoteKeyManager {
  private listeners = new Set<Listener>();
  private lastActionAt = 0;
  private readonly minIntervalMs = 90;
  private boundKeyDown: (e: KeyboardEvent) => void;

  constructor() {
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this.boundKeyDown);
  }

  detach() {
    window.removeEventListener('keydown', this.boundKeyDown);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(action: RemoteAction, digit?: string, isRepeat = false) {
    const now = Date.now();
    if (isRepeat && now - this.lastActionAt < this.minIntervalMs) {
      return;
    }
    this.lastActionAt = now;
    for (const listener of this.listeners) {
      listener({ action, digit, isRepeat });
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      if (e.key === 'Escape') {
        target.blur();
        this.emit('BACK', undefined, e.repeat);
      }
      return;
    }

    const key = e.key;
    const code = e.keyCode;

    if (/^[0-9]$/.test(key)) {
      e.preventDefault();
      this.emit('DIGIT', key, e.repeat);
      return;
    }

    switch (key) {
      case 'ArrowUp':
        e.preventDefault();
        this.emit('UP', undefined, e.repeat);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.emit('DOWN', undefined, e.repeat);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.emit('LEFT', undefined, e.repeat);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.emit('RIGHT', undefined, e.repeat);
        break;
      case 'Enter':
      case 'Select':
        e.preventDefault();
        this.emit('SELECT', undefined, e.repeat);
        break;
      case 'Escape':
      case 'Backspace':
      case 'BrowserBack':
      case 'GoBack':
        e.preventDefault();
        this.emit('BACK', undefined, e.repeat);
        break;
      case 'PageUp':
      case 'ChannelUp':
      case 'MediaTrackNext':
        e.preventDefault();
        this.emit('CHANNEL_UP', undefined, e.repeat);
        break;
      case 'PageDown':
      case 'ChannelDown':
      case 'MediaTrackPrevious':
        e.preventDefault();
        this.emit('CHANNEL_DOWN', undefined, e.repeat);
        break;
      case 'MediaPlayPause':
      case 'MediaPlay':
      case 'MediaPause':
      case ' ':
        e.preventDefault();
        this.emit('PLAY_PAUSE', undefined, e.repeat);
        break;
      case 'Info':
      case 'i':
      case 'I':
        e.preventDefault();
        this.emit('INFO', undefined, e.repeat);
        break;
      case 'ContextMenu':
      case 'm':
      case 'M':
        e.preventDefault();
        this.emit('MENU', undefined, e.repeat);
        break;
      default:
        // Android TV, Samsung Tizen & LG webOS hardware key codes
        if (code === 23) {
          e.preventDefault();
          this.emit('SELECT', undefined, e.repeat);
        } else if (code === 4 || code === 10009 || code === 461) {
          e.preventDefault();
          this.emit('BACK', undefined, e.repeat);
        } else if (code === 427 || code === 166) {
          e.preventDefault();
          this.emit('CHANNEL_UP', undefined, e.repeat);
        } else if (code === 428 || code === 167) {
          e.preventDefault();
          this.emit('CHANNEL_DOWN', undefined, e.repeat);
        } else if (code === 457) {
          e.preventDefault();
          this.emit('INFO', undefined, e.repeat);
        } else if (code === 415 || code === 19 || code === 10252 || code === 85) {
          e.preventDefault();
          this.emit('PLAY_PAUSE', undefined, e.repeat);
        }
        break;
    }
  }
}
